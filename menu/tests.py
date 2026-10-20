import json
from copy import deepcopy
from pathlib import Path

from django.contrib.auth import get_user_model
from django.core.management import call_command
from django.test import TestCase
from django.urls import reverse

from .models import Category, PizzaPrice, Product
from .services import MenuValidationError, build_menu_data, clean_payload, save_menu_data

INITIAL = Path(__file__).resolve().parent / 'initial_data' / 'menu-data.js'


def initial_payload():
    text = INITIAL.read_text(encoding='utf-8')
    return json.loads(text[text.index('{'):text.rindex('}') + 1])


class MenuDataTests(TestCase):
    def setUp(self):
        call_command('load_menu_data')

    def test_ida_y_vuelta_es_identica(self):
        self.assertEqual(build_menu_data(), initial_payload())

    def test_tipos_de_categoria_y_precios_de_pizza(self):
        self.assertEqual(Category.objects.get(slug='clasicas').type, 'clasica')
        self.assertEqual(Category.objects.get(slug='especiales').type, 'premium')
        self.assertEqual(PizzaPrice.objects.get(tier='premium', label='Mediana').price, 44000)
        data = build_menu_data()
        self.assertEqual(next(p for p in data['products'] if p['id'] == 'margarita')['prices'], [])
        combo = next(p for p in data['products'] if p['id'] == 'combo-pizza')
        self.assertEqual(combo['includes'], ['Deditos de queso', 'Gaseosa'])

    def test_guardar_cambios_y_borrar(self):
        d = initial_payload()
        d['pizzaPrices']['premium'][1]['price'] = 46000
        d['products'] = [p for p in d['products'] if p['id'] != 'margarita']
        d['products'][0]['includes'].append('Salsa')
        out = save_menu_data(d)
        self.assertFalse(Product.objects.filter(slug='margarita').exists())
        self.assertEqual(out['pizzaPrices']['premium'][1]['price'], 46000)
        self.assertEqual(out['products'][0]['includes'][-1], 'Salsa')

    def test_cambiar_categoria_a_pizza_quita_precios(self):
        d = initial_payload()
        for c in d['categories']:
            if c['id'] == 'postres':
                c['type'] = 'clasica'
        out = save_menu_data(d)
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
            save_menu_data(d)
        self.assertEqual(build_menu_data(), base)

    def test_load_no_pisa_sin_force(self):
        from django.core.management.base import CommandError
        with self.assertRaises(CommandError):
            call_command('load_menu_data')
        call_command('load_menu_data', '--force')


class ViewTests(TestCase):
    def setUp(self):
        call_command('load_menu_data')
        User = get_user_model()
        self.staff = User.objects.create_user('dueno', password='clave-segura-123', is_staff=True)
        self.cliente = User.objects.create_user('cliente', password='clave-segura-123')

    def test_menu_publico(self):
        r = self.client.get(reverse('menu:index'))
        self.assertContains(r, 'menu-data.js')
        r = self.client.get(reverse('menu:data'))
        self.assertEqual(r['Content-Type'], 'text/javascript; charset=utf-8')
        self.assertTrue(r.content.decode().startswith('window.MENU_DATA = {'))
        self.assertIn('no-cache', r['Cache-Control'])

    def test_panel_pide_login(self):
        r = self.client.get(reverse('menu:panel'))
        self.assertEqual(r.status_code, 302)
        self.assertIn('/admin/login/', r['Location'])
        self.client.force_login(self.cliente)
        self.assertEqual(self.client.get(reverse('menu:panel')).status_code, 302)
        self.client.force_login(self.staff)
        self.assertEqual(self.client.get(reverse('menu:panel')).status_code, 200)

    def test_api_permisos(self):
        url = reverse('menu:api')
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
        sin_token = c.post(reverse('menu:api'), json.dumps(d), content_type='application/json')
        self.assertEqual(sin_token.status_code, 403)
        c.get(reverse('menu:panel'))
        token = c.cookies['csrftoken'].value
        r = c.post(reverse('menu:api'), json.dumps(d), content_type='application/json', headers={'X-CSRFToken': token})
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json()['data']['pizzaPrices']['clasica'][0]['price'], 21000)
        self.assertIn('21000', c.get(reverse('menu:data')).content.decode())
        malo = c.post(reverse('menu:api'), '{no es json', content_type='application/json', headers={'X-CSRFToken': token})
        self.assertEqual(malo.status_code, 400)
        d['products'][-1]['prices'][0]['price'] = -5
        r = c.post(reverse('menu:api'), json.dumps(d), content_type='application/json', headers={'X-CSRFToken': token})
        self.assertEqual(r.status_code, 400)
        self.assertIn('error', r.json())

    def test_logout_solo_post(self):
        self.client.force_login(self.staff)
        self.assertEqual(self.client.get(reverse('menu:logout')).status_code, 405)
        r = self.client.post(reverse('menu:logout'))
        self.assertEqual(r.status_code, 302)
        self.assertEqual(self.client.get(reverse('menu:api')).status_code, 401)


class ExtrasTests(TestCase):
    def setUp(self):
        call_command('load_menu_data')

    def test_adiciones_ida_y_vuelta(self):
        self.assertEqual([x['id'] for x in build_menu_data()['extras']], ['queso-extra', 'tocineta', 'borde-queso'])
        d = initial_payload()
        d['extras'][0]['price'] = 4500
        d['extras'][1]['avail'] = False
        d['extras'].pop()
        d['extras'].append({'id': 'x1', 'name': 'Champiñones', 'price': 3500, 'avail': True, 'all': False, 'for': ['vegetariana', 'no-existe']})
        out = save_menu_data(d)
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

    def test_precio_por_tamano_ida_y_vuelta(self):
        d = initial_payload()
        d['extras'][0].update(bySize=True, prices=[{'label': 'Personal', 'price': 3000}, {'label': 'Mediana', 'price': 4500},
                                                   {'label': 'Grande', 'price': 0}])
        out = save_menu_data(d)
        q = out['extras'][0]
        self.assertTrue(q['bySize'])
        self.assertEqual(q['prices'], [{'label': 'Personal', 'price': 3000}, {'label': 'Mediana', 'price': 4500}])  # 0 = no se ofrece
        d2 = deepcopy(out)
        d2['extras'][0]['bySize'] = False
        self.assertEqual(save_menu_data(d2)['extras'][0]['prices'], [])

    def test_por_tamano_sin_precios_falla(self):
        d = initial_payload()
        d['extras'][0].update(bySize=True, prices=[{'label': 'Personal', 'price': 0}])
        with self.assertRaises(MenuValidationError):
            clean_payload(d)
