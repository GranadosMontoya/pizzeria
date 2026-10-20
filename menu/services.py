"""Convierte entre la base de datos y el formato MENU_DATA que usan el menú y el panel."""
import re

from django.db import transaction

from .models import Business, Category, Extra, PizzaPrice, Product, ProductPrice, Size

ID_RE = re.compile(r'^[A-Za-z0-9_-]{1,64}$')
TAGS = ('veg', 'hot', 'fav')
CAT_TYPES = ('', 'clasica', 'premium', 'combo')
TIERS = ('clasica', 'premium')


class MenuValidationError(ValueError):
    pass


def build_menu_data():
    """Arma el diccionario MENU_DATA con lo que hay en la base de datos."""
    b = Business.load()
    categories = list(Category.objects.all())
    cat_type = {c.pk: c.type for c in categories}
    products = Product.objects.select_related('category').prefetch_related('prices')

    out_products = []
    for p in products:
        t = cat_type[p.category_id]
        item = {
            'id': p.slug, 'cat': p.category.slug, 'name': p.name, 'desc': p.description,
            'tags': list(p.tags or []), 'avail': p.available,
        }
        if t == Category.Type.COMBO:
            item['includes'] = list(p.includes or [])
        item['prices'] = [] if t in (Category.Type.CLASICA, Category.Type.PREMIUM) else [
            {'label': x.label, 'price': x.price} for x in p.prices.all()
        ]
        out_products.append(item)

    pizza = {t: [] for t in TIERS}
    for x in PizzaPrice.objects.all():
        pizza[x.tier].append({'label': x.label, 'price': x.price})

    cats = []
    for c in categories:
        d = {'id': c.slug, 'name': c.name}
        if c.type:
            d['type'] = c.type
        cats.append(d)

    return {
        'business': {'name': b.name, 'tagline': b.tagline, 'hours': b.hours, 'address': b.address, 'whatsapp': b.whatsapp},
        'sizes': [{'name': s.name, 'detail': s.detail} for s in Size.objects.all()],
        'categories': cats,
        'products': out_products,
        'pizzaPrices': pizza,
        'extras': [{'id': e.slug, 'name': e.name, 'price': e.price, 'avail': e.available, 'all': e.all_products,
                    'for': [p.slug for p in e.products.all()]} for e in Extra.objects.prefetch_related('products')],
    }


def _text(v, field, maxlen, required=False):
    if v is None:
        v = ''
    if not isinstance(v, str):
        raise MenuValidationError(f'«{field}» debe ser texto.')
    v = v.strip()
    if required and not v:
        raise MenuValidationError(f'«{field}» no puede estar vacío.')
    if len(v) > maxlen:
        raise MenuValidationError(f'«{field}» es demasiado largo (máximo {maxlen} caracteres).')
    return v


def _money(v, field, allow_zero=False):
    if isinstance(v, bool) or not isinstance(v, (int, float)) or v != int(v):
        raise MenuValidationError(f'«{field}» debe ser un número entero.')
    v = int(v)
    if v < 0 or (v == 0 and not allow_zero) or v > 100_000_000:
        raise MenuValidationError(f'«{field}» no es un precio válido.')
    return v


def _list(v, field):
    if v is None:
        return []
    if not isinstance(v, list):
        raise MenuValidationError(f'«{field}» debe ser una lista.')
    return v


def _dict(v, field):
    if not isinstance(v, dict):
        raise MenuValidationError(f'«{field}» tiene un formato inválido.')
    return v


def clean_payload(payload):
    """Valida lo que manda el panel y devuelve datos limpios. Lanza MenuValidationError."""
    payload = _dict(payload, 'menú')

    biz = _dict(payload.get('business') or {}, 'negocio')
    business = {
        'name': _text(biz.get('name'), 'Nombre del negocio', 120, required=True),
        'tagline': _text(biz.get('tagline'), 'Frase', 300),
        'hours': _text(biz.get('hours'), 'Horario', 120),
        'address': _text(biz.get('address'), 'Dirección', 200),
        'whatsapp': _text(biz.get('whatsapp'), 'WhatsApp', 30),
    }

    sizes, seen = [], set()
    for s in _list(payload.get('sizes'), 'tamaños'):
        s = _dict(s, 'tamaño')
        name = _text(s.get('name'), 'Nombre del tamaño', 40, required=True)
        if name in seen:
            raise MenuValidationError(f'El tamaño «{name}» está repetido.')
        seen.add(name)
        sizes.append({'name': name, 'detail': _text(s.get('detail'), 'Detalle del tamaño', 120)})

    cats, cat_ids = [], {}
    for c in _list(payload.get('categories'), 'categorías'):
        c = _dict(c, 'categoría')
        cid = c.get('id')
        if not isinstance(cid, str) or not ID_RE.match(cid):
            raise MenuValidationError('Una categoría tiene un identificador inválido.')
        if cid in cat_ids:
            raise MenuValidationError('Hay categorías con el mismo identificador.')
        ctype = c.get('type') or ''
        if ctype not in CAT_TYPES:
            raise MenuValidationError(f'Tipo de categoría desconocido: {ctype!r}.')
        cat_ids[cid] = ctype
        cats.append({'id': cid, 'name': _text(c.get('name'), 'Nombre de la categoría', 120, required=True), 'type': ctype})

    products, pids = [], set()
    for p in _list(payload.get('products'), 'productos'):
        p = _dict(p, 'producto')
        pid = p.get('id')
        if not isinstance(pid, str) or not ID_RE.match(pid):
            raise MenuValidationError('Un producto tiene un identificador inválido.')
        if pid in pids:
            raise MenuValidationError('Hay productos con el mismo identificador.')
        pids.add(pid)
        name = _text(p.get('name'), 'Nombre del producto', 120, required=True)
        if p.get('cat') not in cat_ids:
            raise MenuValidationError(f'El producto «{name}» está en una categoría que no existe.')
        ctype = cat_ids[p['cat']]

        tags = _list(p.get('tags'), 'etiquetas')
        if any(t not in TAGS for t in tags):
            raise MenuValidationError(f'El producto «{name}» tiene una etiqueta desconocida.')

        prices = []
        if ctype in ('clasica', 'premium'):
            pass  # el precio de las pizzas sale de pizzaPrices
        else:
            raw = _list(p.get('prices'), 'precios')
            if not raw:
                raise MenuValidationError(f'«{name}» necesita al menos un precio.')
            for x in raw:
                x = _dict(x, 'precio')
                label = _text(x.get('label'), 'Tamaño del precio', 40)
                if (len(raw) > 1 or ctype == 'combo') and not label:
                    raise MenuValidationError(f'«{name}»: con varios precios cada uno necesita su tamaño.')
                prices.append({'label': label, 'price': _money(x.get('price'), f'Precio de {name}')})
            if len({x['label'] for x in prices}) != len(prices):
                raise MenuValidationError(f'«{name}» tiene un tamaño repetido.')

        includes = []
        if ctype == 'combo':
            for t in _list(p.get('includes'), 'incluye'):
                includes.append(_text(t, 'Incluye', 80, required=True))

        products.append({
            'id': pid, 'cat': p['cat'], 'name': name, 'desc': _text(p.get('desc'), 'Descripción', 2000),
            'tags': list(dict.fromkeys(tags)), 'avail': p.get('avail') is not False,
            'includes': includes, 'prices': prices,
        })

    pp_raw = _dict(payload.get('pizzaPrices') or {}, 'precios de pizzas')
    pizza = {}
    for tier in TIERS:
        rows, labels = [], set()
        for x in _list(pp_raw.get(tier), f'precios de pizzas {tier}'):
            x = _dict(x, 'precio de pizza')
            label = _text(x.get('label'), 'Tamaño del precio de pizza', 40, required=True)
            if label in labels:
                continue
            labels.add(label)
            rows.append({'label': label, 'price': _money(x.get('price') or 0, f'Precio {tier} {label}', allow_zero=True)})
        pizza[tier] = rows

    extras, xids = [], set()
    for x in _list(payload.get('extras'), 'adiciones'):
        x = _dict(x, 'adición')
        xid = x.get('id')
        if not isinstance(xid, str) or not ID_RE.match(xid) or xid in xids:
            raise MenuValidationError('Una adición tiene un identificador inválido o repetido.')
        xids.add(xid)
        name = _text(x.get('name'), 'Nombre de la adición', 80, required=True)
        only = [i for i in _list(x.get('for'), 'pizzas de la adición') if i in pids]   # ignora pizzas que ya no existen
        extras.append({'id': xid, 'name': name, 'price': _money(x.get('price'), f'Precio de la adición «{name}»'),
                       'avail': x.get('avail') is not False, 'all': x.get('all') is not False, 'for': list(dict.fromkeys(only))})

    return {'business': business, 'sizes': sizes, 'categories': cats, 'products': products, 'pizzaPrices': pizza, 'extras': extras}


@transaction.atomic
def save_menu_data(payload):
    """Guarda en la base de datos el menú completo que manda el panel (reemplaza lo anterior)."""
    data = clean_payload(payload)

    Business.objects.update_or_create(pk=1, defaults=data['business'])

    Size.objects.all().delete()
    Size.objects.bulk_create([Size(position=i, **s) for i, s in enumerate(data['sizes'])])

    cat_by_slug = {}
    for i, c in enumerate(data['categories']):
        obj, _ = Category.objects.update_or_create(
            slug=c['id'], defaults={'name': c['name'], 'type': c['type'], 'position': i})
        cat_by_slug[c['id']] = obj

    keep = []
    for i, p in enumerate(data['products']):
        obj, _ = Product.objects.update_or_create(slug=p['id'], defaults={
            'category': cat_by_slug[p['cat']], 'name': p['name'], 'description': p['desc'],
            'tags': p['tags'], 'includes': p['includes'], 'available': p['avail'], 'position': i,
        })
        keep.append(obj.pk)
        obj.prices.all().delete()
        ProductPrice.objects.bulk_create([ProductPrice(product=obj, position=j, **x) for j, x in enumerate(p['prices'])])

    Product.objects.exclude(pk__in=keep).delete()
    Category.objects.exclude(slug__in=cat_by_slug.keys()).delete()

    PizzaPrice.objects.all().delete()
    PizzaPrice.objects.bulk_create([
        PizzaPrice(tier=tier, position=j, **x) for tier, rows in data['pizzaPrices'].items() for j, x in enumerate(rows)
    ])

    keep_x = []
    for i, x in enumerate(data['extras']):
        obj, _ = Extra.objects.update_or_create(slug=x['id'], defaults={
            'name': x['name'], 'price': x['price'], 'available': x['avail'], 'all_products': x['all'], 'position': i})
        obj.products.set(Product.objects.filter(slug__in=x['for']))
        keep_x.append(obj.pk)
    Extra.objects.exclude(pk__in=keep_x).delete()
    return build_menu_data()
