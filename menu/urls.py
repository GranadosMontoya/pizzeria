from django.urls import path

from . import views

app_name = 'menu'

# El orden importa: las rutas fijas (panel/) van antes que <slug>/.
urlpatterns = [
    path('', views.home, name='home'),
    path('panel/', views.panel_home, name='panel_home'),
    path('<slug:slug>/', views.index, name='index'),
    path('<slug:slug>/menu-data.js', views.menu_data_js, name='data'),
    path('<slug:slug>/panel/', views.panel, name='panel'),
    path('<slug:slug>/panel/api/', views.api, name='api'),
    path('<slug:slug>/panel/salir/', views.panel_logout, name='logout'),
]
