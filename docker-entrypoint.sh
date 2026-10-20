#!/bin/sh
set -e
# Crea o actualiza las tablas de la base de datos cada vez que arranca el contenedor.
python manage.py migrate --noinput
exec "$@"
