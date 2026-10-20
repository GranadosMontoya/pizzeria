from django.db import models


class Business(models.Model):
    """Datos del negocio. Solo hay una fila (usa Business.load())."""
    name = models.CharField('nombre', max_length=120, default='Mi pizzería')
    tagline = models.CharField('frase', max_length=300, blank=True)
    hours = models.CharField('horario', max_length=120, blank=True)
    address = models.CharField('dirección', max_length=200, blank=True)
    whatsapp = models.CharField('WhatsApp', max_length=30, blank=True,
                                help_text='Con indicativo de país y sin signos. Ej: 573001234567')

    class Meta:
        verbose_name = 'datos del negocio'
        verbose_name_plural = 'datos del negocio'

    def __str__(self):
        return self.name

    @classmethod
    def load(cls):
        obj, _ = cls.objects.get_or_create(pk=1)
        return obj


class Size(models.Model):
    """Tamaños de pizza (Personal, Mediana, Grande…)."""
    name = models.CharField('nombre', max_length=40, unique=True)
    detail = models.CharField('detalle', max_length=120, blank=True)
    position = models.PositiveIntegerField('orden', default=0)

    class Meta:
        ordering = ['position', 'id']
        verbose_name = 'tamaño'
        verbose_name_plural = 'tamaños'

    def __str__(self):
        return self.name


class Category(models.Model):
    class Type(models.TextChoices):
        NORMAL = '', 'Normal (un precio o por tamaño)'
        CLASICA = 'clasica', 'Pizza clásica'
        PREMIUM = 'premium', 'Pizza premium'
        COMBO = 'combo', 'Combo (pizza + extras)'

    slug = models.SlugField('identificador', max_length=64, unique=True)
    name = models.CharField('nombre', max_length=120)
    type = models.CharField('tipo', max_length=10, choices=Type.choices, blank=True, default='')
    position = models.PositiveIntegerField('orden', default=0)

    class Meta:
        ordering = ['position', 'id']
        verbose_name = 'categoría'
        verbose_name_plural = 'categorías'

    def __str__(self):
        return self.name

    @property
    def is_pizza(self):
        return self.type in (self.Type.CLASICA, self.Type.PREMIUM)


class Product(models.Model):
    slug = models.SlugField('identificador', max_length=64, unique=True)
    category = models.ForeignKey(Category, verbose_name='categoría', on_delete=models.CASCADE, related_name='products')
    name = models.CharField('nombre', max_length=120)
    description = models.TextField('descripción', blank=True)
    tags = models.JSONField('etiquetas', default=list, blank=True,
                            help_text='Lista con: veg, hot, fav (vegetariana, picante, favorita)')
    includes = models.JSONField('incluye', default=list, blank=True,
                                help_text='Solo combos: lo que incluye además de la pizza. Ej: ["Deditos de queso", "Gaseosa"]')
    available = models.BooleanField('disponible', default=True)
    position = models.PositiveIntegerField('orden', default=0)

    class Meta:
        ordering = ['position', 'id']
        verbose_name = 'producto'
        verbose_name_plural = 'productos'

    def __str__(self):
        return self.name


class ProductPrice(models.Model):
    """Precio de un producto normal o de un combo (base). Las pizzas no usan esta tabla."""
    product = models.ForeignKey(Product, on_delete=models.CASCADE, related_name='prices')
    label = models.CharField('tamaño', max_length=40, blank=True, help_text='Vacío si el producto tiene un solo precio')
    price = models.PositiveIntegerField('precio')
    position = models.PositiveIntegerField('orden', default=0)

    class Meta:
        ordering = ['position', 'id']
        verbose_name = 'precio'
        verbose_name_plural = 'precios'

    def __str__(self):
        return f'{self.product} {self.label} ${self.price}'


class PizzaPrice(models.Model):
    """Precio de una pizza de un solo sabor según su tipo y tamaño.

    clásica + clásica = precio clásica
    premium + clásica = precio premium
    premium + premium = precio premium + (precio premium − precio clásica)
    """
    class Tier(models.TextChoices):
        CLASICA = 'clasica', 'Clásica'
        PREMIUM = 'premium', 'Premium'

    tier = models.CharField('tipo', max_length=10, choices=Tier.choices)
    label = models.CharField('tamaño', max_length=40)
    price = models.PositiveIntegerField('precio')
    position = models.PositiveIntegerField('orden', default=0)

    class Meta:
        ordering = ['tier', 'position', 'id']
        unique_together = [('tier', 'label')]
        verbose_name = 'precio de pizza'
        verbose_name_plural = 'precios de pizzas'

    def __str__(self):
        return f'{self.get_tier_display()} {self.label} ${self.price}'


class Extra(models.Model):
    """Adición con precio que el cliente puede sumar a una pizza o a un combo (queso extra, tocineta…)."""
    slug = models.SlugField('identificador', max_length=64, unique=True)
    name = models.CharField('nombre', max_length=80)
    price = models.PositiveIntegerField('precio', help_text='Precio único, cuando no cambia por tamaño')
    by_size = models.BooleanField('precio por tamaño', default=False,
                                  help_text='Si está activo, se usan los precios por tamaño de abajo en vez del precio único')
    available = models.BooleanField('disponible', default=True)
    all_products = models.BooleanField('para todas las pizzas', default=True,
                                       help_text='Si está apagado, solo aplica a las pizzas elegidas abajo')
    products = models.ManyToManyField(Product, blank=True, related_name='extras', verbose_name='pizzas')
    position = models.PositiveIntegerField('orden', default=0)

    class Meta:
        ordering = ['position', 'id']
        verbose_name = 'adición'
        verbose_name_plural = 'adiciones'

    def __str__(self):
        return self.name


class ExtraPrice(models.Model):
    """Precio de una adición para un tamaño de pizza (solo si la adición tiene precio por tamaño)."""
    extra = models.ForeignKey(Extra, on_delete=models.CASCADE, related_name='size_prices')
    label = models.CharField('tamaño', max_length=40)
    price = models.PositiveIntegerField('precio')
    position = models.PositiveIntegerField('orden', default=0)

    class Meta:
        ordering = ['position', 'id']
        verbose_name = 'precio por tamaño'
        verbose_name_plural = 'precios por tamaño'

    def __str__(self):
        return f'{self.extra} {self.label} ${self.price}'
