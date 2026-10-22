from django.contrib import admin

from .models import (Business, BusinessMember, Category, Extra, ExtraPrice, PizzaPrice, Product, ProductPrice, Size)


@admin.register(Business)
class BusinessAdmin(admin.ModelAdmin):
    list_display = ('name', 'slug', 'hours', 'whatsapp')
    prepopulated_fields = {'slug': ('name',)}
    search_fields = ('name', 'slug')


@admin.register(BusinessMember)
class BusinessMemberAdmin(admin.ModelAdmin):
    """Aquí se asigna cada usuario al negocio que administra."""
    list_display = ('user', 'business')
    list_filter = ('business',)
    autocomplete_fields = ('user',)
    search_fields = ('user__username',)


@admin.register(Size)
class SizeAdmin(admin.ModelAdmin):
    list_display = ('name', 'business', 'detail', 'position')
    list_filter = ('business',)


@admin.register(Category)
class CategoryAdmin(admin.ModelAdmin):
    list_display = ('name', 'business', 'type', 'position')
    list_filter = ('business',)


class ProductPriceInline(admin.TabularInline):
    model = ProductPrice
    extra = 1


@admin.register(Product)
class ProductAdmin(admin.ModelAdmin):
    list_display = ('name', 'business', 'category', 'available', 'position')
    list_filter = ('business', 'category', 'available')
    search_fields = ('name', 'description')
    inlines = [ProductPriceInline]


@admin.register(PizzaPrice)
class PizzaPriceAdmin(admin.ModelAdmin):
    list_display = ('business', 'tier', 'label', 'price', 'position')
    list_filter = ('business', 'tier')


class ExtraPriceInline(admin.TabularInline):
    model = ExtraPrice
    extra = 0


@admin.register(Extra)
class ExtraAdmin(admin.ModelAdmin):
    inlines = [ExtraPriceInline]
    list_display = ('name', 'business', 'price', 'by_size', 'available', 'position')
    list_filter = ('business',)
    filter_horizontal = ('products',)
