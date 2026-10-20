FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .
# Por si Git en Windows convirtió los saltos de línea del script.
RUN sed -i 's/\r$//' docker-entrypoint.sh && chmod +x docker-entrypoint.sh

# Junta los archivos estáticos (css/js) dentro de la imagen.
RUN python manage.py collectstatic --noinput

# Usuario sin privilegios y carpeta /data para la base de datos (se monta como volumen).
RUN useradd --system --no-create-home app && mkdir /data && chown app:app /data
USER app

EXPOSE 8000
ENTRYPOINT ["./docker-entrypoint.sh"]
CMD ["gunicorn", "config.wsgi:application", "--bind", "0.0.0.0:8000", "--workers", "2", "--access-logfile", "-"]
