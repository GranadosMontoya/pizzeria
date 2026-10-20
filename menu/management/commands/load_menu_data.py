import json
from pathlib import Path

from django.core.management.base import BaseCommand, CommandError

from menu.models import Product
from menu.services import MenuValidationError, save_menu_data

DEFAULT = Path(__file__).resolve().parents[2] / 'initial_data' / 'menu-data.js'


class Command(BaseCommand):
    help = 'Carga el menú desde un archivo menu-data.js (por defecto, el de ejemplo incluido).'

    def add_arguments(self, parser):
        parser.add_argument('path', nargs='?', default=str(DEFAULT), help='Ruta a menu-data.js')
        parser.add_argument('--force', action='store_true', help='Reemplaza el menú aunque ya tenga productos')

    def handle(self, *args, **opts):
        path = Path(opts['path'])
        if not path.exists():
            raise CommandError(f'No existe {path}')
        if Product.objects.exists() and not opts['force']:
            raise CommandError('Ya hay productos en la base de datos. Usa --force para reemplazarlos.')
        text = path.read_text(encoding='utf-8')
        try:
            payload = json.loads(text[text.index('{'):text.rindex('}') + 1])
            save_menu_data(payload)
        except (ValueError, MenuValidationError) as e:
            raise CommandError(f'No se pudo cargar: {e}')
        self.stdout.write(self.style.SUCCESS(f'Menú cargado desde {path.name}'))
