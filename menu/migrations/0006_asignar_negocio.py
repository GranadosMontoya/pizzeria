from django.conf import settings
from django.db import migrations
from django.utils.text import slugify

RESERVED = {'admin', 'panel', 'static', 'api', 'media'}


def asignar(apps, schema_editor):
    """Todo lo que ya existe pasa a ser el primer negocio, sin perder nada."""
    Business = apps.get_model('menu', 'Business')
    Member = apps.get_model('menu', 'BusinessMember')
    owned = [apps.get_model('menu', n) for n in ('Size', 'Category', 'Product', 'Extra', 'PizzaPrice')]

    if not Business.objects.exists():
        if not any(m.objects.exists() for m in owned):
            return                                    # base nueva y vacía: no hay nada que migrar
        Business.objects.create(name='Mi pizzería')

    used = set()
    for b in Business.objects.order_by('pk'):
        base = slugify(b.name)[:40] or 'negocio'
        if base in RESERVED:
            base += '-menu'
        slug, n = base, 2
        while slug in used:
            slug, n = f'{base}-{n}', n + 1
        used.add(slug)
        b.slug = slug
        b.save(update_fields=['slug'])

    first = Business.objects.order_by('pk').first()
    for m in owned:
        m.objects.filter(business__isnull=True).update(business=first)

    # Los usuarios del panel que ya existían siguen entrando, ahora ligados a ese negocio.
    app_label, model_name = settings.AUTH_USER_MODEL.split('.')
    User = apps.get_model(app_label, model_name)
    for u in User.objects.filter(is_staff=True, is_superuser=False):
        Member.objects.get_or_create(user=u, defaults={'business': first})


class Migration(migrations.Migration):
    dependencies = [
        ('menu', '0005_multi_business_columnas'),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]
    operations = [migrations.RunPython(asignar, migrations.RunPython.noop)]
