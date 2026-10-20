from django.contrib import admin

from .models import Business, Category, Extra, ExtraPrice, PizzaPrice, Product, ProductPrice, Size


@admin.register(Business)
class BusinessAdmin(admin.ModelAdmin):
    list_display = ('name', 'hours', 'whatsapp')

    def has_add_permission(self, request):
        return not Business.objects.exists()

    def has_delete_permission(self, request, obj=None):
        return False


@admin.register(Size)
class SizeAdmin(admin.ModelAdmin):
    list_display = ('name', 'detail', 'position')
    list_editable = ('position',)


@admin.register(Category)
class CategoryAdmin(admin.ModelAdmin):
    list_display = ('name', 'type', 'position')
    list_editable = ('position',)
    prepopulated_fields = {'slug': ('name',)}


class ProductPriceInline(admin.TabularInline):
    model = ProductPrice
    extra = 1


@admin.register(Product)
class ProductAdmin(admin.ModelAdmin):
    list_display = ('name', 'category', 'available', 'position')
    list_filter = ('category', 'available')
    list_editable = ('available', 'position')
    search_fields = ('name', 'description')
    prepopulated_fields = {'slug': ('name',)}
    inlines = [ProductPriceInline]


@admin.register(PizzaPrice)
class PizzaPriceAdmin(admin.ModelAdmin):
    list_display = ('tier', 'label', 'price', 'position')
    list_editable = ('price', 'position')
    list_filter = ('tier',)


class ExtraPriceInline(admin.TabularInline):
    model = ExtraPrice
    extra = 0


@admin.register(Extra)
class ExtraAdmin(admin.ModelAdmin):
    inlines = [ExtraPriceInline]
    list_display = ('name', 'price', 'by_size', 'available', 'position')
    list_editable = ('price', 'available', 'position')
    prepopulated_fields = {'slug': ('name',)}
    filter_horizontal = ('products',)
