import json
from functools import wraps

from django.http import HttpResponse, JsonResponse
from django.middleware.csrf import get_token
from django.shortcuts import redirect, render
from django.urls import reverse
from django.contrib.admin.views.decorators import staff_member_required
from django.contrib.auth import logout
from django.views.decorators.cache import never_cache
from django.views.decorators.http import require_http_methods, require_POST

from .models import Business
from .services import MenuValidationError, build_menu_data, save_menu_data


def index(request):
    """Menú público para los clientes."""
    return render(request, 'menu/index.html', {'business': Business.load()})


@never_cache
def menu_data_js(request):
    """Datos del menú como JavaScript (window.MENU_DATA), siempre actuales."""
    body = 'window.MENU_DATA = ' + json.dumps(build_menu_data(), ensure_ascii=False, indent=2) + ';\n'
    return HttpResponse(body, content_type='text/javascript; charset=utf-8')


@never_cache
@staff_member_required
def panel(request):
    """Panel para cambiar precios, sabores y productos (solo personal con acceso al admin)."""
    config = {
        'api': reverse('menu:api'),
        'logout': reverse('menu:logout'),
        'menuUrl': reverse('menu:index'),
        'djangoAdmin': reverse('admin:index'),
        'passwordUrl': reverse('admin:password_change'),
        'user': request.user.get_username(),
        'csrf': get_token(request),
    }
    return render(request, 'menu/panel.html', {'config': config})


def staff_api(view):
    """Como staff_member_required, pero responde JSON en vez de redirigir."""
    @wraps(view)
    def wrapper(request, *args, **kwargs):
        if not request.user.is_authenticated:
            return JsonResponse({'error': 'Tu sesión expiró. Vuelve a entrar.'}, status=401)
        if not (request.user.is_active and request.user.is_staff):
            return JsonResponse({'error': 'No tienes permiso para cambiar el menú.'}, status=403)
        return view(request, *args, **kwargs)
    return wrapper


@never_cache
@staff_api
@require_http_methods(['GET', 'POST'])
def api(request):
    if request.method == 'GET':
        return JsonResponse({'data': build_menu_data()})
    try:
        payload = json.loads(request.body.decode('utf-8'))
    except (ValueError, UnicodeDecodeError):
        return JsonResponse({'error': 'El menú enviado no es válido.'}, status=400)
    try:
        data = save_menu_data(payload)
    except MenuValidationError as e:
        return JsonResponse({'error': str(e)}, status=400)
    return JsonResponse({'data': data})


@require_POST
def panel_logout(request):
    logout(request)
    return redirect('menu:index')
