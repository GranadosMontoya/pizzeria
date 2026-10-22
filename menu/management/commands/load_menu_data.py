import json
from pathlib import Path

from django.core.management.base import BaseCommand, CommandError
from django.utils.text import slugify

from menu.models import RESERVED_SLUGS, Business, Product
from menu.services import MenuValidationError, save_menu_data

DEFAULT = Path(__file__).resolve().parents[2] / 'initial_data' / 'menu-data.js'


class Command(BaseCommand):
    help = 'Carga un menú desde un archivo menu-data.js (por defecto, el de ejemplo) en un negocio. Si el negocio no existe, lo crea.'

    def add_arguments(self, parser):
        parser.add_argument('path', nargs='?', default=str(DEFAULT), help='Ruta a menu-data.js')
        parser.add_argument('--slug', default='pizzeria', help='Dirección del negocio (ej: pizzeria-a). Por defecto: pizzeria')
        parser.add_argument('--force', action='store_true', help='Reemplaza el menú de ese negocio aunque ya tenga productos')

    def handle(self, *args, **opts):
        path = Path(opts['path'])
        if not path.exists():
            raise CommandError(f'No existe {path}')
        slug = slugify(opts['slug'])
        if not slug or slug.lower() in RESERVED_SLUGS:
            raise CommandError('Esa dirección no es válida o está reservada.')
        business = Business.objects.filter(slug=slug).first()
        if business and Product.objects.filter(business=business).exists() and not opts['force']:
            raise CommandError(f'El negocio «{slug}» ya tiene productos. Usa --force para reemplazarlos.')
        text = path.read_text(encoding='utf-8')
        try:
            payload = json.loads(text[text.index('{'):text.rindex('}') + 1])
            if business is None:
                business = Business.objects.create(slug=slug, name=(payload.get('business') or {}).get('name') or slug)
            save_menu_data(business, payload)
        except (ValueError, MenuValidationError) as e:
            raise CommandError(f'No se pudo cargar: {e}')
        self.stdout.write(self.style.SUCCESS(f'Menú cargado en el negocio «{business.name}» (/{business.slug}/)'))
