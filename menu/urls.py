from django.urls import path

from . import views

app_name = 'menu'

urlpatterns = [
    path('', views.index, name='index'),
    path('menu-data.js', views.menu_data_js, name='data'),
    path('panel/', views.panel, name='panel'),
    path('panel/api/', views.api, name='api'),
    path('panel/salir/', views.panel_logout, name='logout'),
]
