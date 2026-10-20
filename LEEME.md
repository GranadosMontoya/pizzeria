# Pizzería · menú y panel en Django

Menú para clientes (con pedido por WhatsApp) y panel para cambiar precios, sabores, combos y
productos. Todo se guarda en la base de datos de Django; el menú muestra los cambios apenas
guardas en el panel (ya no hay que descargar ni subir `menu-data.js`).

## Puesta en marcha

```bash
python -m venv venv
source venv/bin/activate          # en Windows: venv\Scripts\activate
pip install -r requirements.txt
python manage.py migrate
python manage.py load_menu_data   # carga el menú de ejemplo (solo la primera vez)
python manage.py createsuperuser  # tu usuario y contraseña para el panel
python manage.py runserver
```

- Menú de los clientes: <http://127.0.0.1:8000/>
- Panel: <http://127.0.0.1:8000/panel/> (entras con el usuario que creaste)
- Admin de Django (opcional, los mismos datos en formato de tablas): <http://127.0.0.1:8000/admin/>

Para cargar tu propio `menu-data.js` en vez del de ejemplo:
`python manage.py load_menu_data ruta/a/menu-data.js --force` (reemplaza lo que haya).

## Quién puede entrar al panel

Cualquier usuario con **acceso al sitio de administración** (`is_staff`). Crea más usuarios en
`/admin/` → Usuarios. La contraseña se cambia desde el enlace «Cambiar mi contraseña» del panel.
El panel ya no usa `auth.js`: el acceso es el de Django (sesión + protección CSRF), y la API de
guardado responde 401/403 a quien no tenga permiso.

## Pizzas de dos sabores y combos

- El **tipo de cada categoría** se elige en el panel (pestaña «Categorías»): Normal, Pizza clásica,
  Pizza premium o Combo.
- Las pizzas no llevan precio propio: se definen en la pestaña **«Precios de pizzas»**, un precio
  por tamaño para clásica y otro para premium (los valores del ejemplo son de muestra).
- El cliente elige un sabor o «Mitad y mitad». Precio:
  - clásica + clásica = precio clásica
  - premium + clásica = precio premium
  - premium + premium = precio premium + (precio premium − precio clásica)
- Si un precio queda en 0, ese tamaño no se vende.
- **Combos**: el cliente elige tamaño y sabor de la pizza (también puede ser mitad y mitad). Lo que
  incluye además (deditos, gaseosa…) se escribe en «Incluye». El precio del combo es un precio base
  por tamaño (con pizza clásica) y se le suma la misma diferencia si elige sabores premium.

## Estructura

```
config/            ajustes, urls, wsgi/asgi
menu/models.py     Business, Size, Category, Product, ProductPrice, PizzaPrice
menu/services.py   base de datos <-> formato MENU_DATA, con validación al guardar
menu/views.py      menú público, /menu-data.js, panel, API del panel
menu/templates/    index.html (menú) y panel.html
menu/static/       menu.js/menu.css (clientes) y admin.js/admin.css (panel)
menu/tests.py      pruebas (python manage.py test)
```

## Producción

Define estas variables de entorno (no edites `settings.py`):

```
DJANGO_DEBUG=0
DJANGO_SECRET_KEY=<una clave larga y aleatoria>
DJANGO_ALLOWED_HOSTS=tusitio.com,www.tusitio.com
DJANGO_CSRF_TRUSTED_ORIGINS=https://tusitio.com
```

Luego `python manage.py collectstatic --noinput` y sirve con gunicorn/uwsgi
(`gunicorn config.wsgi`). WhiteNoise entrega los archivos estáticos. En producción usa HTTPS
(las cookies de sesión y CSRF quedan marcadas como seguras).

## Notas

- El pedido llega por WhatsApp: pon el número en el panel, «Negocio y tamaños» (con indicativo,
  sin signos, p. ej. `573001234567`).
- Guardar desde el panel reemplaza el menú completo con lo que ves en pantalla. Si dos personas
  editan a la vez, gana quien guarde último.
- Si cambias el nombre de un tamaño en el panel, se actualiza en todos los precios.
