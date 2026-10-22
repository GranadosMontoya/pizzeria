import json
from functools import wraps

from django.contrib.auth import logout
from django.http import HttpResponse, HttpResponseForbidden, JsonResponse
from django.middleware.csrf import get_token
from django.shortcuts import get_object_or_404, redirect, render
from django.urls import reverse
from django.views.decorators.cache import never_cache
from django.views.decorators.http import require_http_methods, require_POST

from .models import Business, BusinessMember
from .services import MenuValidationError, build_menu_data, save_menu_data


def can_manage(user, business):
    """El dueño de la plataforma (superusuario) entra a todos; el resto solo a su negocio."""
    if not (user.is_authenticated and user.is_active and user.is_staff):
        return False
    if user.is_superuser:
        return True
    member = BusinessMember.objects.filter(user=user).first()
    return member is not None and member.business_id == business.pk


def home(request):
    """Raíz del sitio. Un cliente nunca ve la lista de negocios: cada uno entra por SU enlace (/<dirección>/).
    - Con un solo negocio lleva directo a su menú.
    - Con varios, el público ve una página neutra (sin nombres); solo el superusuario ve la lista.
    """
    businesses = list(Business.objects.all())
    if len(businesses) == 1:
        return redirect('menu:index', slug=businesses[0].slug)
    user = request.user
    if user.is_authenticated and user.is_active and user.is_staff and user.is_superuser:
        return render(request, 'menu/home.html', {'businesses': businesses})
    return render(request, 'menu/no_menu.html', status=404)


def index(request, slug):
    """Menú público de un negocio."""
    return render(request, 'menu/index.html', {'business': get_object_or_404(Business, slug=slug)})


@never_cache
def menu_data_js(request, slug):
    """Datos del menú de un negocio como JavaScript (window.MENU_DATA), siempre actuales."""
    business = get_object_or_404(Business, slug=slug)
    body = 'window.MENU_DATA = ' + json.dumps(build_menu_data(business), ensure_ascii=False, indent=2) + ';\n'
    return HttpResponse(body, content_type='text/javascript; charset=utf-8')


def _staff_required(view):
    """Pide iniciar sesión (admin de Django) y que el usuario sea del personal."""
    from django.contrib.admin.views.decorators import staff_member_required
    return staff_member_required(view)


@never_cache
@_staff_required
def panel_home(request):
    """/panel/: lleva a cada usuario al panel de su negocio."""
    member = BusinessMember.objects.select_related('business').filter(user=request.user).first()
    if member:
        return redirect('menu:panel', slug=member.business.slug)
    if request.user.is_superuser:
        businesses = list(Business.objects.all())
        if len(businesses) == 1:
            return redirect('menu:panel', slug=businesses[0].slug)
        return render(request, 'menu/home.html', {'businesses': businesses, 'panel': True})
    return HttpResponseForbidden('Tu usuario todavía no está asignado a ningún negocio. Pídele al administrador que lo asigne.')


@never_cache
@_staff_required
def panel(request, slug):
    """Panel para cambiar precios, sabores y productos de UN negocio."""
    business = get_object_or_404(Business, slug=slug)
    if not can_manage(request.user, business):
        return HttpResponseForbidden('No tienes permiso para administrar este negocio.')
    config = {
        'api': reverse('menu:api', args=[business.slug]),
        'logout': reverse('menu:logout', args=[business.slug]),
        'menuUrl': reverse('menu:index', args=[business.slug]),
        'djangoAdmin': reverse('admin:index'),
        'passwordUrl': reverse('admin:password_change'),
        'user': request.user.get_username(),
        'business': business.name,
        'csrf': get_token(request),
    }
    return render(request, 'menu/panel.html', {'config': config, 'business': business})


def business_api(view):
    """API del panel: responde JSON (no redirige) y solo deja pasar a quien administra ese negocio."""
    @wraps(view)
    def wrapper(request, slug, *args, **kwargs):
        if not request.user.is_authenticated:
            return JsonResponse({'error': 'Tu sesión expiró. Vuelve a entrar.'}, status=401)
        business = get_object_or_404(Business, slug=slug)
        if not can_manage(request.user, business):
            return JsonResponse({'error': 'No tienes permiso para cambiar el menú de este negocio.'}, status=403)
        return view(request, business, *args, **kwargs)
    return wrapper


@never_cache
@business_api
@require_http_methods(['GET', 'POST'])
def api(request, business):
    if request.method == 'GET':
        return JsonResponse({'data': build_menu_data(business)})
    try:
        payload = json.loads(request.body.decode('utf-8'))
    except (ValueError, UnicodeDecodeError):
        return JsonResponse({'error': 'El menú enviado no es válido.'}, status=400)
    try:
        data = save_menu_data(business, payload)
    except MenuValidationError as e:
        return JsonResponse({'error': str(e)}, status=400)
    return JsonResponse({'data': data})


@require_POST
def panel_logout(request, slug):
    logout(request)
    return redirect('menu:index', slug=slug)
