import json
from copy import deepcopy
from pathlib import Path

from django.contrib.auth import get_user_model
from django.core.management import call_command
from django.test import TestCase
from django.urls import reverse

from .models import Business, BusinessMember, Category, PizzaPrice, Product
from .services import MenuValidationError, build_menu_data, clean_payload, save_menu_data

INITIAL = Path(__file__).resolve().parent / 'initial_data' / 'menu-data.js'


def initial_payload():
    text = INITIAL.read_text(encoding='utf-8')
    return json.loads(text[text.index('{'):text.rindex('}') + 1])


class MenuDataTests(TestCase):
    def setUp(self):
        call_command('load_menu_data')
        self.b = Business.objects.get(slug='pizzeria')

    def test_ida_y_vuelta_es_identica(self):
        self.assertEqual(build_menu_data(self.b), initial_payload())

    def test_tipos_de_categoria_y_precios_de_pizza(self):
        self.assertEqual(Category.objects.get(slug='clasicas').type, 'clasica')
        self.assertEqual(Category.objects.get(slug='especiales').type, 'premium')
        self.assertEqual(PizzaPrice.objects.get(tier='premium', label='Mediana').price, 44000)
        data = build_menu_data(self.b)
        self.assertEqual(next(p for p in data['products'] if p['id'] == 'margarita')['prices'], [])
        combo = next(p for p in data['products'] if p['id'] == 'combo-pizza')
        self.assertEqual(combo['includes'], ['Deditos de queso', 'Gaseosa'])

    def test_guardar_cambios_y_borrar(self):
        d = initial_payload()
        d['pizzaPrices']['premium'][1]['price'] = 46000
        d['products'] = [p for p in d['products'] if p['id'] != 'margarita']
        d['products'][0]['includes'].append('Salsa')
        out = save_menu_data(self.b, d)
        self.assertFalse(Product.objects.filter(slug='margarita').exists())
        self.assertEqual(out['pizzaPrices']['premium'][1]['price'], 46000)
        self.assertEqual(out['products'][0]['includes'][-1], 'Salsa')

    def test_cambiar_categoria_a_pizza_quita_precios(self):
        d = initial_payload()
        for c in d['categories']:
            if c['id'] == 'postres':
                c['type'] = 'clasica'
        out = save_menu_data(self.b, d)
        postre = next(p for p in out['products'] if p['cat'] == 'postres')
        self.assertEqual(postre['prices'], [])

    def test_validaciones(self):
        base = initial_payload()
        casos = {
            'precio cero': lambda d: d['products'][-1]['prices'][0].__setitem__('price', 0),
            'categoria inexistente': lambda d: d['products'][-1].__setitem__('cat', 'nada'),
            'id repetido': lambda d: d['products'][1].__setitem__('id', d['products'][2]['id']),
            'tipo raro': lambda d: d['categories'][0].__setitem__('type', 'otro'),
            'etiqueta rara': lambda d: d['products'][-1].__setitem__('tags', ['x']),
            'tamano repetido': lambda d: d['sizes'].append(deepcopy(d['sizes'][0])),
            'sin nombre': lambda d: d['products'][-1].__setitem__('name', '  '),
        }
        for nombre, mutar in casos.items():
            d = deepcopy(base)
            mutar(d)
            with self.subTest(nombre), self.assertRaises(MenuValidationError):
                clean_payload(d)
        # un error de validación no cambia nada en la base
        d = deepcopy(base)
        d['products'][-1]['prices'][0]['price'] = 0
        with self.assertRaises(MenuValidationError):
            save_menu_data(self.b, d)
        self.assertEqual(build_menu_data(self.b), base)

    def test_load_no_pisa_sin_force(self):
        from django.core.management.base import CommandError
        with self.assertRaises(CommandError):
            call_command('load_menu_data')
        call_command('load_menu_data', '--force')


class ViewTests(TestCase):
    def setUp(self):
        call_command('load_menu_data')
        self.b = Business.objects.get(slug='pizzeria')
        User = get_user_model()
        self.staff = User.objects.create_user('dueno', password='clave-segura-123', is_staff=True)
        self.cliente = User.objects.create_user('cliente', password='clave-segura-123')
        BusinessMember.objects.create(user=self.staff, business=self.b)

    def test_menu_publico(self):
        r = self.client.get(reverse('menu:index', args=['pizzeria']))
        self.assertContains(r, 'menu-data.js')
        r = self.client.get(reverse('menu:data', args=['pizzeria']))
        self.assertEqual(r['Content-Type'], 'text/javascript; charset=utf-8')
        self.assertTrue(r.content.decode().startswith('window.MENU_DATA = {'))
        self.assertIn('no-cache', r['Cache-Control'])

    def test_panel_pide_login(self):
        r = self.client.get(reverse('menu:panel', args=['pizzeria']))
        self.assertEqual(r.status_code, 302)
        self.assertIn('/admin/login/', r['Location'])
        self.client.force_login(self.cliente)
        self.assertEqual(self.client.get(reverse('menu:panel', args=['pizzeria'])).status_code, 302)
        self.client.force_login(self.staff)
        self.assertEqual(self.client.get(reverse('menu:panel', args=['pizzeria'])).status_code, 200)

    def test_api_permisos(self):
        url = reverse('menu:api', args=['pizzeria'])
        self.assertEqual(self.client.get(url).status_code, 401)
        self.assertEqual(self.client.post(url, '{}', content_type='application/json').status_code, 401)
        self.client.force_login(self.cliente)
        self.assertEqual(self.client.get(url).status_code, 403)

    def test_api_guardar_y_csrf(self):
        from django.test import Client
        c = Client(enforce_csrf_checks=True)
        c.force_login(self.staff)
        d = initial_payload()
        d['pizzaPrices']['clasica'][0]['price'] = 21000
        sin_token = c.post(reverse('menu:api', args=['pizzeria']), json.dumps(d), content_type='application/json')
        self.assertEqual(sin_token.status_code, 403)
        c.get(reverse('menu:panel', args=['pizzeria']))
        token = c.cookies['csrftoken'].value
        r = c.post(reverse('menu:api', args=['pizzeria']), json.dumps(d), content_type='application/json', headers={'X-CSRFToken': token})
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json()['data']['pizzaPrices']['clasica'][0]['price'], 21000)
        self.assertIn('21000', c.get(reverse('menu:data', args=['pizzeria'])).content.decode())
        malo = c.post(reverse('menu:api', args=['pizzeria']), '{no es json', content_type='application/json', headers={'X-CSRFToken': token})
        self.assertEqual(malo.status_code, 400)
        d['products'][-1]['prices'][0]['price'] = -5
        r = c.post(reverse('menu:api', args=['pizzeria']), json.dumps(d), content_type='application/json', headers={'X-CSRFToken': token})
        self.assertEqual(r.status_code, 400)
        self.assertIn('error', r.json())

    def test_logout_solo_post(self):
        self.client.force_login(self.staff)
        self.assertEqual(self.client.get(reverse('menu:logout', args=['pizzeria'])).status_code, 405)
        r = self.client.post(reverse('menu:logout', args=['pizzeria']))
        self.assertEqual(r.status_code, 302)
        self.assertEqual(self.client.get(reverse('menu:api', args=['pizzeria'])).status_code, 401)


class ExtrasTests(TestCase):
    def setUp(self):
        call_command('load_menu_data')
        self.b = Business.objects.get(slug='pizzeria')

    def test_adiciones_ida_y_vuelta(self):
        self.assertEqual([x['id'] for x in build_menu_data(self.b)['extras']], ['queso-extra', 'tocineta', 'borde-queso'])
        d = initial_payload()
        d['extras'][0]['price'] = 4500
        d['extras'][1]['avail'] = False
        d['extras'].pop()
        d['extras'].append({'id': 'x1', 'name': 'Champiñones', 'price': 3500, 'avail': True, 'all': False, 'for': ['vegetariana', 'no-existe']})
        out = save_menu_data(self.b, d)
        self.assertEqual([(x['id'], x['price'], x['avail']) for x in out['extras']],
                         [('queso-extra', 4500, True), ('tocineta', 5000, False), ('x1', 3500, True)])
        self.assertEqual(out['extras'][1]['for'], ['carnes'])
        self.assertEqual((out['extras'][2]['all'], out['extras'][2]['for']), (False, ['vegetariana']))

    def test_adicion_invalida(self):
        for mutar in (lambda x: x.update(price=0), lambda x: x.update(name=' '), lambda x: x.update(id='con espacio')):
            d = initial_payload()
            mutar(d['extras'][0])
            with self.assertRaises(MenuValidationError):
                clean_payload(d)


class ExtrasPorTamanoTests(TestCase):
    def setUp(self):
        call_command('load_menu_data')
        self.b = Business.objects.get(slug='pizzeria')

    def test_precio_por_tamano_ida_y_vuelta(self):
        d = initial_payload()
        d['extras'][0].update(bySize=True, prices=[{'label': 'Personal', 'price': 3000}, {'label': 'Mediana', 'price': 4500},
                                                   {'label': 'Grande', 'price': 0}])
        out = save_menu_data(self.b, d)
        q = out['extras'][0]
        self.assertTrue(q['bySize'])
        self.assertEqual(q['prices'], [{'label': 'Personal', 'price': 3000}, {'label': 'Mediana', 'price': 4500}])  # 0 = no se ofrece
        d2 = deepcopy(out)
        d2['extras'][0]['bySize'] = False
        self.assertEqual(save_menu_data(self.b, d2)['extras'][0]['prices'], [])

    def test_por_tamano_sin_precios_falla(self):
        d = initial_payload()
        d['extras'][0].update(bySize=True, prices=[{'label': 'Personal', 'price': 0}])
        with self.assertRaises(MenuValidationError):
            clean_payload(d)


class VariosNegociosTests(TestCase):
    """Cada negocio solo ve y cambia lo suyo."""

    def setUp(self):
        call_command('load_menu_data')                                  # negocio A: /pizzeria/
        call_command('load_menu_data', '--slug', 'pizza-b')             # negocio B: /pizza-b/
        self.a = Business.objects.get(slug='pizzeria')
        self.bb = Business.objects.get(slug='pizza-b')
        User = get_user_model()
        self.ua = User.objects.create_user('dueno_a', password='clave-segura-123', is_staff=True)
        self.ub = User.objects.create_user('dueno_b', password='clave-segura-123', is_staff=True)
        self.root = User.objects.create_superuser('root', password='clave-segura-123')
        BusinessMember.objects.create(user=self.ua, business=self.a)
        BusinessMember.objects.create(user=self.ub, business=self.bb)

    def test_cada_negocio_tiene_sus_datos(self):
        datos_a, datos_b = build_menu_data(self.a), build_menu_data(self.bb)
        datos_b['business'] = datos_a['business']
        self.assertEqual(datos_a, datos_b)       # mismo menú de ejemplo, guardado por separado
        self.assertEqual(Product.objects.filter(business=self.a).count(), Product.objects.filter(business=self.bb).count())
        self.assertEqual(Product.objects.count(), 2 * Product.objects.filter(business=self.a).count())  # mismos identificadores, sin chocar

    def test_guardar_en_a_no_toca_b(self):
        antes_b = build_menu_data(self.bb)
        d = initial_payload()
        d['pizzaPrices']['premium'][1]['price'] = 99000
        d['products'] = d['products'][:3]
        d['business']['name'] = 'Pizzería A renovada'
        save_menu_data(self.a, d)
        self.assertEqual(build_menu_data(self.bb), antes_b)
        self.assertEqual(Product.objects.filter(business=self.a).count(), 3)
        self.assertEqual(Business.objects.get(pk=self.a.pk).name, 'Pizzería A renovada')

    def test_ids_de_otro_negocio_no_se_pueden_secuestrar(self):
        # B manda los mismos identificadores que A: se crean/actualizan solo en B
        d = initial_payload()
        d['products'][0]['name'] = 'Cambiado por B'
        save_menu_data(self.bb, d)
        self.assertNotEqual(Product.objects.get(business=self.a, slug=d['products'][0]['id']).name, 'Cambiado por B')

    def test_panel_y_api_solo_para_su_negocio(self):
        api_a, api_b = reverse('menu:api', args=['pizzeria']), reverse('menu:api', args=['pizza-b'])
        self.client.force_login(self.ua)
        self.assertEqual(self.client.get(api_a).status_code, 200)
        self.assertEqual(self.client.get(api_b).status_code, 403)
        self.assertEqual(self.client.post(api_b, '{}', content_type='application/json').status_code, 403)
        self.assertEqual(self.client.get(reverse('menu:panel', args=['pizzeria'])).status_code, 200)
        self.assertEqual(self.client.get(reverse('menu:panel', args=['pizza-b'])).status_code, 403)
        self.client.force_login(self.root)   # el dueño de la plataforma entra a todos
        self.assertEqual(self.client.get(api_a).status_code, 200)
        self.assertEqual(self.client.get(api_b).status_code, 200)

    def test_panel_home_lleva_al_negocio_del_usuario(self):
        self.client.force_login(self.ub)
        r = self.client.get(reverse('menu:panel_home'))
        self.assertEqual(r.status_code, 302)
        self.assertEqual(r['Location'], reverse('menu:panel', args=['pizza-b']))

    def test_staff_sin_negocio_no_entra(self):
        sin = get_user_model().objects.create_user('sin_negocio', password='x', is_staff=True)
        self.client.force_login(sin)
        self.assertEqual(self.client.get(reverse('menu:panel', args=['pizzeria'])).status_code, 403)
        self.assertEqual(self.client.get(reverse('menu:panel_home')).status_code, 403)
        self.assertEqual(self.client.get(reverse('menu:api', args=['pizzeria'])).status_code, 403)

    def test_menu_publico_por_ruta(self):
        self.assertEqual(self.client.get('/pizzeria/').status_code, 200)
        self.assertEqual(self.client.get('/pizza-b/').status_code, 200)
        self.assertEqual(self.client.get('/no-existe/').status_code, 404)
        self.assertEqual(self.client.get('/no-existe/menu-data.js').status_code, 404)
        self.assertContains(self.client.get('/pizza-b/'), '/pizza-b/menu-data.js')

    def test_raiz(self):
        # Con dos negocios, el público NO ve la lista ni ningún nombre.
        r = self.client.get('/')
        self.assertEqual(r.status_code, 404)
        self.assertNotContains(r, '/pizza-b/', status_code=404)
        self.assertNotContains(r, '/pizzeria/', status_code=404)
        self.assertNotContains(r, self.a.name, status_code=404)
        # Un dueño de negocio tampoco ve la lista.
        self.client.force_login(self.ua)
        self.assertEqual(self.client.get('/').status_code, 404)
        # El superusuario sí (le sirve para entrar a cada negocio).
        self.client.force_login(self.root)
        r = self.client.get('/')
        self.assertEqual(r.status_code, 200)
        self.assertContains(r, '/pizza-b/')
        # Con un solo negocio, lleva directo a su menú.
        self.client.logout()
        self.bb.delete()
        r = self.client.get('/')
        self.assertEqual(r.status_code, 302)
        self.assertEqual(r['Location'], '/pizzeria/')

    def test_direcciones_reservadas(self):
        from django.core.exceptions import ValidationError
        for slug in ('admin', 'panel', 'static'):
            with self.subTest(slug), self.assertRaises(ValidationError):
                Business(name='x', slug=slug).full_clean()
        from django.core.management.base import CommandError
        with self.assertRaises(CommandError):
            call_command('load_menu_data', '--slug', 'admin')

    def test_borrar_negocio_borra_solo_lo_suyo(self):
        total_a = Product.objects.filter(business=self.a).count()
        self.bb.delete()
        self.assertEqual(Product.objects.count(), total_a)
        self.assertTrue(get_user_model().objects.filter(username='dueno_b').exists())   # el usuario se conserva
