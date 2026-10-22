/* Menú público con pedido. Lee los datos de menu-data.js (window.MENU_DATA).
   Todo se puede elegir (tamaño, cantidad, nota, entrega, pago) y el pedido
   completo se arma como un solo mensaje para el chat de WhatsApp. */
(function () {
  'use strict';

  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var esc = function (s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  };
  var money = function (n) { return '$' + String(Math.round(Number(n) || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, '.'); };
  var norm = function (s) { return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase(); };
  var TAGS = { veg: 'Vegetariana', hot: 'Picante', fav: 'Favorita' };
  var DELIVERY = [{ id: 'domicilio', name: 'Domicilio' }, { id: 'local', name: 'Recoger en el local' }];
  var PAYS = [{ id: 'efectivo', name: 'Efectivo' }, { id: 'transferencia', name: 'Transferencia' }];
  var MAXQ = 99;
  var reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;

  var $app = $('#app');
  var data = window.MENU_DATA;
  if (!data || !data.categories || !data.products) {
    $app.innerHTML = '<div class="empty"><h2>No se pudo cargar el menú</h2><p>Vuelve a intentarlo en un momento.</p></div>';
    return;
  }

  var biz = data.business || {};
  var sizes = data.sizes || [];
  var cats = data.categories;
  var catById = {};
  cats.forEach(function (c) { catById[c.id] = c; });
  var byId = {}, order = {};
  var products = data.products.map(function (p, i) {
    p.tags = p.tags || [];
    p.avail = p.avail !== false;
    p.includes = Array.isArray(p.includes) ? p.includes : [];
    byId[p.id] = p; order[p.id] = i;
    return p;
  });
  /* El tipo de un producto es el de su categoría: 'clasica' o 'premium' (pizzas), 'combo' o nada. */
  function typeOf(p) { var c = catById[p.cat]; return (c && c.type) || ''; }
  function isPizza(p) { var t = typeOf(p); return t === 'clasica' || t === 'premium'; }
  function isCombo(p) { return typeOf(p) === 'combo'; }
  products.forEach(function (p) {
    // Las pizzas no llevan precio propio: lo define su tipo (clásica/premium) y el tamaño.
    p.prices = isPizza(p) ? [] : ((p.prices && p.prices.length) ? p.prices : [{ label: '', price: 0 }]);
  });
  var waNum = String(biz.whatsapp || '').replace(/\D/g, '');
  document.title = (biz.name ? biz.name + ' · ' : '') + 'Menú';

  var ui = { cat: null, q: '', size: '', fVeg: false, fHot: false, sel: {}, open: false, tried: false, notes: {}, confirmClear: false, cfg: {} };
  var cart = [];   // { id, label, fl: [sabores], qty, note }
  var form = { name: '', type: '', address: '', pay: '', cash: '', notes: '' };
  var KEY = 'pedido:' + (location.pathname.split('/').filter(Boolean)[0] || biz.name || 'menu');   // un carrito por negocio
  var lastFocus = null, toastT = 0;

  /* ---------- Precios de pizza ----------
     Hay un precio por tamaño para las clásicas y otro para las premium (pizzaPrices).
       clásica + clásica  = precio clásica
       premium + clásica  = precio premium
       premium + premium  = precio premium + (precio premium − precio clásica)
     Una pizza de un solo sabor cuesta el precio de su tipo. */
  var pz = data.pizzaPrices || {};
  function tierPrice(tier, size) {
    var a = pz[tier] || [];
    for (var i = 0; i < a.length; i++) if (a[i].label === size) return Number(a[i].price) || 0;
    return 0;
  }
  function pizzaSizes() {   // tamaños que se venden: los que tienen precio clásica y premium
    return sizes.map(function (s) { return s.name; }).filter(function (n) {
      return tierPrice('clasica', n) > 0 && tierPrice('premium', n) > 0;
    });
  }
  function pizzaPrice(fl, size) {
    var c = tierPrice('clasica', size), pr = tierPrice('premium', size);
    var prem = fl.filter(function (id) { return typeOf(byId[id]) === 'premium'; }).length;
    if (prem >= 2) return pr + (pr - c);
    return prem === 1 ? pr : c;
  }
  function isFlavor(id) { var p = byId[id]; return !!p && isPizza(p) && p.avail; }
  function canonFl(fl) { return fl.slice().sort(function (a, b) { return order[a] - order[b]; }); }
  function flKey(fl) { return (fl || []).join('+'); }
  function flNames(fl) { return fl.map(function (id) { return byId[id].name; }); }
  function priceOf(p, label) {
    for (var i = 0; i < p.prices.length; i++) if (p.prices[i].label === label) return p.prices[i];
    return null;
  }
  /* Tamaños con su precio para un producto y unos sabores. En un combo el precio base se mueve
     igual que la pizza: sube lo que suba el sabor elegido respecto a una clásica. */
  function optsFor(p, fl) {
    if (isPizza(p) || isCombo(p)) {
      var ok = pizzaSizes();
      if (isPizza(p)) return ok.map(function (n) { return { label: n, price: pizzaPrice(fl, n) }; });
      return p.prices.filter(function (x) { return x.label && ok.indexOf(x.label) > -1; }).map(function (x) {
        return { label: x.label, price: x.price + pizzaPrice(fl, x.label) - tierPrice('clasica', x.label) };
      });
    }
    return p.prices;
  }
  function hasLabel(o, label) { return o.some(function (x) { return x.label === label; }); }
  function unitPrice(l, label) {
    var p = byId[l.id]; if (!p) return null;
    var o = optsFor(p, l.fl || []);
    for (var i = 0; i < o.length; i++) if (o[i].label === label) return o[i].price + exTotal(l.ex, label);
    return null;
  }
  function lineTitle(l) {
    var p = byId[l.id];
    if (isPizza(p) && l.fl.length > 1) return 'Pizza ½ ' + flNames(l.fl).join(' + ½ ');
    return p.name;
  }
  function lineDetails(l) {
    var p = byId[l.id], out = [];
    if (isCombo(p)) {
      out.push('Pizza: ' + (l.fl.length > 1 ? '½ ' + flNames(l.fl).join(' + ½ ') : flNames(l.fl)[0]));
      if (p.includes.length) out.push('Incluye: ' + p.includes.join(', '));
    }
    if (l.ex && l.ex.length) out.push('Adiciones: ' + l.ex.map(function (id) { return byEx[id].name + ' (+' + money(exPrice(byEx[id], l.label)) + ')'; }).join(', '));
    return out;
  }

  /* ---------- Adiciones (extras con precio para pizzas y combos) ---------- */
  var extras = (data.extras || []).filter(function (x) {
    return x.avail !== false && (x.bySize ? (x.prices || []).some(function (r) { return Number(r.price) > 0; }) : Number(x.price) > 0);
  });
  var byEx = {}, exOrder = {};
  extras.forEach(function (x, i) { byEx[x.id] = x; exOrder[x.id] = i; });
  /* Precio de una adición según el tamaño de la pizza (0 = no se ofrece en ese tamaño). */
  function exPrice(x, label) {
    if (!x.bySize) return Number(x.price) || 0;
    var a = x.prices || [];
    for (var i = 0; i < a.length; i++) if (a[i].label === label) return Number(a[i].price) || 0;
    return 0;
  }
  function exTotal(ids, label) { return (ids || []).reduce(function (s, id) { return s + (byEx[id] ? exPrice(byEx[id], label) : 0); }, 0); }
  /* Una adición aplica a todas las pizzas o solo a las que el dueño marcó (en un combo, a los sabores elegidos). */
  function exApplies(x, fl) { return x.all !== false || (x['for'] || []).some(function (id) { return (fl || []).indexOf(id) > -1; }); }
  function lineKey(l) { return flKey(l.fl) + ((l.ex && l.ex.length) ? '~' + l.ex.join('+') : ''); }

  /* ---------- Carrito ---------- */
  function find(id, label, fl) {
    for (var i = 0; i < cart.length; i++) if (cart[i].id === id && cart[i].label === label && lineKey(cart[i]) === fl) return i;
    return -1;
  }
  function qtyOf(id, label, fl) { var i = find(id, label, fl); return i < 0 ? 0 : cart[i].qty; }
  function qtyAll(id) {
    return cart.reduce(function (s, l) { return s + (l.id === id || l.fl.indexOf(id) > -1 ? l.qty : 0); }, 0);
  }
  function addLine(id, label, fl, q, note) {
    var i = find(id, label, fl);
    if (i > -1) { cart[i].qty = Math.min(MAXQ, cart[i].qty + q); if (note && !cart[i].note) cart[i].note = note; }
    else {
      var parts = String(fl || '').split('~');
      cart.push({ id: id, label: label, fl: parts[0] ? parts[0].split('+') : [], ex: parts[1] ? parts[1].split('+') : [], qty: Math.min(MAXQ, q), note: note || '' });
    }
  }
  function setQty(id, label, fl, delta) {
    var i = find(id, label, fl);
    if (i < 0) { if (delta > 0) addLine(id, label, fl, delta); return; }
    cart[i].qty = Math.min(MAXQ, cart[i].qty + delta);
    if (cart[i].qty <= 0) cart.splice(i, 1);
  }
  function lineTotal(l) { var u = unitPrice(l, l.label); return (u || 0) * l.qty; }
  function cartCount() { return cart.reduce(function (s, l) { return s + l.qty; }, 0); }
  function cartTotal() { return cart.reduce(function (s, l) { return s + lineTotal(l); }, 0); }
  function touched(id, fl) {   // tarjetas del menú que hay que repintar cuando cambia una línea
    return [id].concat(fl ? String(fl).split('~')[0].split('+').filter(Boolean) : []).filter(function (v, i, a) { return a.indexOf(v) === i; });
  }

  function save() {
    try { localStorage.setItem(KEY, JSON.stringify({ cart: cart, form: form })); } catch (e) { /* sin almacenamiento */ }
  }
  function load() {
    try {
      var s = JSON.parse(localStorage.getItem(KEY) || 'null');
      if (!s) return;
      if (Array.isArray(s.cart)) s.cart.forEach(function (l) {
        var p = byId[l && l.id];
        if (!p || !p.avail) return;                                   // producto borrado o agotado
        var fl = Array.isArray(l.fl) ? l.fl : [];
        if (isPizza(p) && !fl.length) fl = [p.id];                    // pedidos guardados antes de las mitades
        var id = p.id;
        if (isPizza(p) || isCombo(p)) {
          if (!fl.length || fl.length > 2 || !fl.every(isFlavor)) return;   // algún sabor ya no existe o se agotó
          fl = canonFl(fl.filter(function (v, i, a) { return a.indexOf(v) === i; }));
          if (isPizza(p)) id = fl[0];
        } else fl = [];
        var ex = Array.isArray(l.ex) ? l.ex : [];
        if (ex.length && ((!isPizza(p) && !isCombo(p)) || !ex.every(function (x) { return byEx[x] && exApplies(byEx[x], fl) && exPrice(byEx[x], l.label || '') > 0; }))) return;   // adición que ya no existe
        ex = ex.filter(function (v, i, a) { return a.indexOf(v) === i; }).sort(function (a, b) { return exOrder[a] - exOrder[b]; });
        var q = Math.min(MAXQ, parseInt(l.qty, 10) || 0);
        if (q > 0 && unitPrice({ id: id, fl: fl, ex: ex }, l.label || '') !== null) {
          addLine(id, l.label || '', flKey(fl) + (ex.length ? '~' + ex.join('+') : ''), q, String(l.note || '').slice(0, 120));
        }
      });
      if (s.form) ['name', 'type', 'address', 'pay', 'cash', 'notes'].forEach(function (k) {
        if (typeof s.form[k] === 'string') form[k] = s.form[k];
      });
      if (!DELIVERY.some(function (d) { return d.id === form.type; })) form.type = '';
      if (!PAYS.some(function (d) { return d.id === form.pay; })) form.pay = '';
    } catch (e) { /* datos viejos o dañados: se ignoran */ }
  }

  /* ---------- Mensaje de WhatsApp ---------- */
  function nameOf(arr, id) { for (var i = 0; i < arr.length; i++) if (arr[i].id === id) return arr[i].name; return ''; }
  function message() {
    var L = [];
    L.push('*Pedido · ' + (biz.name || 'Pizzería') + '*', '');
    L.push('*Nombre:* ' + (form.name.trim() || '(sin nombre)'));
    L.push('*Entrega:* ' + nameOf(DELIVERY, form.type));
    if (form.type === 'domicilio') L.push('*Dirección:* ' + (form.address.trim() || '(sin dirección)'));
    var pay = nameOf(PAYS, form.pay), cash = parseInt(form.cash, 10);
    if (form.pay === 'efectivo' && cash > 0) pay += ' (paga con ' + money(cash) + ')';
    L.push('*Pago:* ' + pay, '', '*Productos:*');
    cart.forEach(function (l) {
      L.push('• ' + l.qty + ' × ' + lineTitle(l) + (l.label ? ' (' + l.label + ')' : '') + ' — ' + money(lineTotal(l)));
      lineDetails(l).forEach(function (d) { L.push('   ' + d); });
      if (l.note) L.push('   _Nota: ' + l.note + '_');
    });
    L.push('', '*Total:* ' + money(cartTotal()) + (form.type === 'domicilio' ? ' _(domicilio no incluido)_' : ''));
    if (form.notes.trim()) L.push('', '*Comentarios:* ' + form.notes.trim());
    return L.join('\n');
  }

  /* ---------- Menú ---------- */
  /* Sabores elegidos en la tarjeta de una pizza o de un combo (f1: sabor del combo, f2: segunda mitad). */
  function cfgOf(p) {
    var c = ui.cfg[p.id] || (ui.cfg[p.id] = { f1: '', f2: '', half: false });
    if (!isFlavor(c.f1)) c.f1 = '';
    var base = isPizza(p) ? p.id : c.f1;
    if (!c.half || !base || !isFlavor(c.f2) || c.f2 === base) c.f2 = '';
    return c;
  }
  function cardFlavors(p) {
    var c = cfgOf(p), fl;
    if (isPizza(p)) fl = [p.id];
    else if (isCombo(p) && c.f1) fl = [c.f1];
    else return [];
    if (c.f2) fl.push(c.f2);
    return canonFl(fl);
  }
  function cardLine(p, label) {
    var fl = cardFlavors(p);
    return { id: isPizza(p) ? fl[0] : p.id, label: label, fl: fl };
  }
  function sizeOpts(p) { return optsFor(p, cardFlavors(p)); }
  function selLabel(p) {
    var o = sizeOpts(p);
    if (!o.length) return null;
    if (o.length === 1) return o[0].label;                    // un solo precio: no hay nada que elegir
    var s = ui.sel[p.id];
    if (s != null && hasLabel(o, s)) return s;
    if (ui.size && hasLabel(o, ui.size)) return ui.size;      // solo si el cliente tocó el filtro de tamaño
    return null;                                              // sin elegir
  }
  function usedSizes() {
    var labels = {};
    products.forEach(function (p) {
      if (isPizza(p)) return;
      p.prices.forEach(function (x) { if (x.label) labels[x.label] = 1; });
    });
    if (products.some(isPizza)) pizzaSizes().forEach(function (n) { labels[n] = 1; });
    return sizes.filter(function (s) { return labels[s.name]; });
  }
  function visibleCats() {
    var q = norm(ui.q);
    return cats.map(function (c) {
      var items = products.filter(function (p) {
        return p.cat === c.id &&
          (!q || norm(p.name + ' ' + (p.desc || '')).indexOf(q) > -1) &&
          (!ui.fVeg || p.tags.indexOf('veg') > -1) &&
          (!ui.fHot || p.tags.indexOf('hot') > -1);
      });
      return { c: c, items: items };
    }).filter(function (x) { return x.items.length; });
  }

  function stepperHTML(id, label, fl, q) {
    var a = 'data-id="' + esc(id) + '" data-label="' + esc(label) + '" data-fl="' + esc(fl) + '"', k = esc(id) + '|' + esc(label) + '|' + esc(fl);
    return '<div class="step" role="group" aria-label="Cantidad"><button type="button" class="sb" data-act="dec" ' + a + ' data-f="d|' + k +
      '" aria-label="Quitar uno">−</button><output class="sq" aria-live="polite">' + q + '</output><button type="button" class="sb" data-act="inc" ' + a +
      ' data-f="q|' + k + '" aria-label="Agregar uno"' + (q >= MAXQ ? ' disabled' : '') + '>+</button></div>';
  }
  function pricesHTML(p) {
    var o = sizeOpts(p);
    if (!o.length) return '<p class="desc">Precios por definir.</p>';
    var single = o.length === 1 && !o[0].label;
    if (single) return '<div class="prices single"><span class="pv">' + money(o[0].price) + '</span></div>';
    var cur = selLabel(p);
    return '<div class="prices" role="radiogroup" aria-label="Tamaño de ' + esc(p.name) + '">' + o.map(function (x) {
      var inner = '<span class="pl">' + esc(x.label) + '</span><span class="pv">' + money(x.price) + '</span>';
      if (!p.avail) return '<div class="price">' + inner + '</div>';
      var on = x.label === cur;
      return '<button type="button" role="radio" aria-checked="' + on + '" class="price' + (on ? ' on' : '') + '" data-act="pick" data-id="' +
        esc(p.id) + '" data-label="' + esc(x.label) + '">' + inner + '</button>';
    }).join('') + '</div>';
  }
  /* Opciones de sabor agrupadas por tipo de pizza (solo las que hay hoy). */
  function flavorOptions(selected, exclude) {
    return cats.filter(function (c) { return c.type === 'clasica' || c.type === 'premium'; }).map(function (c) {
      var items = products.filter(function (p) { return p.cat === c.id && p.avail && p.id !== exclude; });
      if (!items.length) return '';
      return '<optgroup label="' + esc(c.name) + '">' + items.map(function (p) {
        return '<option value="' + esc(p.id) + '"' + (p.id === selected ? ' selected' : '') + '>' + esc(p.name) + '</option>';
      }).join('') + '</optgroup>';
    }).join('');
  }
  function stepT(n, text) { return '<p class="step-t">' + n + '. ' + text + '</p>'; }
  /* «Pizza entera» / «Mitad y mitad»: dos botones; el segundo sabor solo aparece si eligen mitad y mitad. */
  function modeHTML(p) {
    var c = cfgOf(p), id = esc(p.id);
    function b(v, text) {
      var on = (v === 'half') === c.half;
      return '<button type="button" role="radio" aria-checked="' + on + '" class="opt' + (on ? ' on' : '') + '" data-act="mode" data-id="' + id +
        '" data-v="' + v + '" data-f="m|' + id + '|' + v + '">' + text + '</button>';
    }
    var h = '<div class="opts" role="radiogroup" aria-label="Entera o mitad y mitad">' + b('whole', 'Pizza entera') + b('half', 'Mitad y mitad') + '</div>';
    if (c.half) {
      h += '<label class="pick"><span>¿Con qué otro sabor?</span><select class="in" data-sel="f2" data-id="' + id + '" data-f="s2|' + id + '">' +
        '<option value="">Elige el otro sabor</option>' + flavorOptions(c.f2, isPizza(p) ? p.id : c.f1) + '</select></label>';
      var fl = cardFlavors(p);
      if (fl.length > 1) h += '<p class="mix">Mitad ' + flNames(fl).map(esc).join(' + mitad ') + '</p>';
    }
    return h;
  }
  /* Pasos numerados de una pizza o un combo, siempre en el mismo orden. */
  function stepsHTML(p) {
    var c = cfgOf(p), id = esc(p.id);
    if (isCombo(p)) {
      var h = stepT(1, 'Elige el sabor de la pizza') + '<label class="pick"><select class="in" data-sel="f1" data-id="' + id + '" data-f="s1|' + id + '" aria-label="Sabor de la pizza">' +
        '<option value="">Elige un sabor</option>' + flavorOptions(c.f1, '') + '</select></label>' + stepT(2, 'Elige el tamaño') + pricesHTML(p);
      if (c.f1) h += stepT(3, '¿Entera o mitad y mitad?') + modeHTML(p);
      return h;
    }
    return stepT(1, 'Elige el tamaño') + pricesHTML(p) + stepT(2, '¿Entera o mitad y mitad?') + modeHTML(p);
  }
  function buyHTML(p) {
    if (!p.avail || !sizeOpts(p).length) return '';
    if (isCombo(p) && !cfgOf(p).f1) return '<div class="buy"><button type="button" class="btn add" disabled>Elige el sabor</button></div>';
    if (cfgOf(p).half && cardFlavors(p).length < 2) return '<div class="buy"><button type="button" class="btn add" disabled>Elige el otro sabor</button></div>';
    var lab = selLabel(p);
    if (lab === null) return '<div class="buy"><button type="button" class="btn add" disabled>Elige un tamaño</button></div>';
    var ln = cardLine(p, lab), fk = flKey(ln.fl), q = qtyOf(ln.id, lab, fk);
    var addTxt = '+ Agregar' + ((isPizza(p) || isCombo(p)) ? ' ' + esc(lab) + (ln.fl.length > 1 ? ' · mitad ' + flNames(ln.fl).map(esc).join(' + mitad ') : '') : '');
    if (q) return '<div class="buy">' + stepperHTML(ln.id, lab, fk, q) + '</div>';
    return '<div class="buy"><button type="button" class="btn primary add" data-act="inc" data-id="' + esc(ln.id) + '" data-label="' + esc(lab) + '" data-fl="' + esc(fk) +
      '" data-f="q|' + esc(ln.id) + '|' + esc(lab) + '|' + esc(fk) + '">' + addTxt + '</button></div>';
  }
  function itemHTML(p) {
    var tags = p.tags.filter(function (t) { return TAGS[t]; }).map(function (t) {
      return '<span class="tag ' + t + '">' + TAGS[t] + '</span>';
    }).join('');
    if (!p.avail) tags += '<span class="tag out">Agotado hoy</span>';
    var n = qtyAll(p.id);
    if (n) tags += '<span class="tag bag">' + n + ' en tu pedido</span>';
    return '<article class="item' + (p.avail ? '' : ' out') + '" data-id="' + esc(p.id) + '"><div class="item-head"><h3>' + esc(p.name) + '</h3>' +
      (tags ? '<div class="tags">' + tags + '</div>' : '') + '</div>' +
      (p.desc ? '<p class="desc">' + esc(p.desc) + '</p>' : '') +
      (isCombo(p) && p.includes.length ? '<p class="incl">Incluye: ' + esc(['Pizza'].concat(p.includes).join(' · ')) + '</p>' : '') +
      ((p.avail && (isPizza(p) || isCombo(p))) ? stepsHTML(p) : pricesHTML(p)) + buyHTML(p) + '</article>';
  }
  function listHTML() {
    var vc = visibleCats();
    if (!vc.length) {
      var none = !products.length;
      return '<div class="empty"><h2>' + (none ? 'El menú está vacío' : 'No encontramos platos así') + '</h2><p>' +
        (none ? 'Pronto habrá productos aquí.' : 'Prueba con otra palabra o quita los filtros.') + '</p>' +
        (none ? '' : '<button class="btn" type="button" data-act="clear-filters">Quitar filtros</button>') + '</div>';
    }
    return vc.map(function (x) {
      return '<section class="cat" data-sec="' + esc(x.c.id) + '" aria-labelledby="h-' + esc(x.c.id) + '"><h2 id="h-' + esc(x.c.id) + '">' +
        esc(x.c.name) + '<span class="count">' + x.items.length + '</span></h2><div class="items">' + x.items.map(itemHTML).join('') + '</div></section>';
    }).join('');
  }
  function chipsHTML() {
    var vc = visibleCats();
    if (!vc.some(function (x) { return x.c.id === ui.cat; })) ui.cat = vc.length ? vc[0].c.id : null;
    return vc.map(function (x) {
      return '<button type="button" class="chip-b' + (x.c.id === ui.cat ? ' on' : '') + '" data-act="cat" data-cat="' + esc(x.c.id) + '">' + esc(x.c.name) + '</button>';
    }).join('');
  }
  function filtersHTML() {
    var us = usedSizes(), h = '';
    if (us.length) {
      h += '<div class="seg" role="group" aria-label="Tamaño de todas las pizzas"><span class="seg-l">Tamaño</span><div class="seg-b">' +
        '<button type="button" data-act="size" data-size="" class="' + (!ui.size ? 'on' : '') + '" aria-pressed="' + (!ui.size) + '">Todos</button>' +
        us.map(function (s) {
          return '<button type="button" data-act="size" data-size="' + esc(s.name) + '" class="' + (ui.size === s.name ? 'on' : '') + '" aria-pressed="' + (ui.size === s.name) + '">' + esc(s.name) + '</button>';
        }).join('') + '</div></div>';
    }
    h += '<div class="toggles"><button type="button" class="tg" data-act="fveg" aria-pressed="' + ui.fVeg + '">Vegetarianas</button>' +
      '<button type="button" class="tg hot" data-act="fhot" aria-pressed="' + ui.fHot + '">Picantes</button></div>';
    var cur = us.filter(function (s) { return s.name === ui.size; })[0];
    if (cur && cur.detail) h += '<p class="size-note"><strong>' + esc(cur.name) + ':</strong> ' + esc(cur.detail) + '</p>';
    return h;
  }

  /* ---------- Hoja del pedido ---------- */
  function optsHTML(list, cur, act, label) {
    return '<div class="opts" role="radiogroup" aria-label="' + esc(label) + '">' + list.map(function (o) {
      var on = o.id === cur;
      return '<button type="button" role="radio" aria-checked="' + on + '" class="opt' + (on ? ' on' : '') + '" data-act="' + act + '" data-v="' + esc(o.id) +
        '" data-f="' + act + '|' + esc(o.id) + '">' + esc(o.name) + '</button>';
    }).join('') + '</div>';
  }
  function lineHTML(l) {
    var p = byId[l.id], fk = lineKey(l), k = esc(l.id) + '|' + esc(l.label) + '|' + esc(fk);
    var a = 'data-id="' + esc(l.id) + '" data-label="' + esc(l.label) + '" data-fl="' + esc(fk) + '"';
    var o = optsFor(p, l.fl);
    var labeled = o.filter(function (x) { return x.label; }).length > 1;
    var det = lineDetails(l).map(function (d) { return '<p class="l-sub">' + esc(d) + '</p>'; }).join('');
    var sz = '';
    if (labeled) {
      sz = '<div class="opts sm" role="radiogroup" aria-label="Tamaño de ' + esc(lineTitle(l)) + '">' + o.map(function (x) {
        var on = x.label === l.label;
        return '<button type="button" role="radio" aria-checked="' + on + '" class="opt' + (on ? ' on' : '') + '" data-act="lsize" ' + a + ' data-to="' + esc(x.label) +
          '" data-f="ls|' + k + '|' + esc(x.label) + '">' + esc(x.label) + ' · ' + money(x.price + exTotal(l.ex, x.label)) + '</button>';
      }).join('') + '</div>';
    } else if (l.label) {
      sz = '<p class="l-sub">' + esc(l.label) + '</p>';
    }
    var exb = '';
    var exs = extras.filter(function (x) { return exApplies(x, l.fl) && exPrice(x, l.label) > 0; });
    if (exs.length && (isPizza(p) || isCombo(p))) {
      exb = '<p class="l-sub">Adiciones</p><div class="opts sm" role="group" aria-label="Adiciones">' + exs.map(function (x) {
        var on = (l.ex || []).indexOf(x.id) > -1;
        return '<button type="button" class="opt' + (on ? ' on' : '') + '" aria-pressed="' + on + '" data-act="lextra" ' + a + ' data-x="' + esc(x.id) +
          '" data-f="lx|' + k + '|' + esc(x.id) + '">' + (on ? '✓ ' : '+ ') + esc(x.name) + ' · ' + money(exPrice(x, l.label)) + '</button>';
      }).join('') + '</div>';
    }
    var showNote = l.note || ui.notes[l.id + '|' + l.label + '|' + fk];
    return '<li class="line"><div class="l-top"><h3>' + esc(lineTitle(l)) + '</h3><span class="l-price">' + money(lineTotal(l)) + '</span></div>' + det + sz + exb +
      '<div class="l-row">' + stepperHTML(l.id, l.label, fk, l.qty) +
      '<button type="button" class="lnk" data-act="note" ' + a + ' data-f="nb|' + k + '">' + (showNote ? 'Quitar nota' : '+ Nota') + '</button>' +
      '<button type="button" class="lnk del" data-act="rm" ' + a + ' data-f="rm|' + k + '">Eliminar</button></div>' +
      (showNote ? '<input class="in" type="text" maxlength="120" placeholder="Ej: sin cebolla, bien horneada" value="' + esc(l.note) + '" data-note ' + a +
        ' data-f="n|' + k + '" aria-label="Nota para ' + esc(lineTitle(l)) + '">' : '') + '</li>';
  }
  function fieldErr(id, text, show) {
    return '<p class="err" id="e-' + id + '"' + (show ? '' : ' hidden') + '>' + esc(text) + '</p>';
  }
  function formHTML() {
    var domi = form.type === 'domicilio';
    var badName = ui.tried && !form.name.trim(), badAddr = ui.tried && domi && !form.address.trim();
    var badType = ui.tried && !form.type, badPay = ui.tried && !form.pay;
    return '<section class="form" aria-label="Datos del pedido">' +
      '<h3 class="f-h">¿Cómo lo quieres?</h3>' + optsHTML(DELIVERY, form.type, 'dt', 'Tipo de entrega') + fieldErr('type', 'Elige cómo quieres recibir tu pedido.', badType) +
      '<div class="fld"><label for="f-name">Tu nombre</label><input class="in" id="f-name" data-fld="name" type="text" maxlength="60" autocomplete="name" autocapitalize="words" value="' +
        esc(form.name) + '"' + (badName ? ' aria-invalid="true"' : '') + ' aria-describedby="e-name">' + fieldErr('name', 'Escribe tu nombre para el pedido.', badName) + '</div>' +
      (domi ? '<div class="fld"><label for="f-address">Dirección de entrega</label><input class="in" id="f-address" data-fld="address" type="text" maxlength="160" autocomplete="street-address" placeholder="Calle, número, barrio, apartamento" value="' +
        esc(form.address) + '"' + (badAddr ? ' aria-invalid="true"' : '') + ' aria-describedby="e-address">' + fieldErr('address', 'Escribe la dirección para el domicilio.', badAddr) + '</div>' : '') +
      '<h3 class="f-h">¿Cómo pagas?</h3>' + optsHTML(PAYS, form.pay, 'py', 'Forma de pago') + fieldErr('pay', 'Elige cómo vas a pagar.', badPay) +
      (form.pay === 'efectivo' ? '<div class="fld"><label for="f-cash">¿Con cuánto pagas? <span class="opt-l">(opcional)</span></label><input class="in" id="f-cash" data-fld="cash" type="text" inputmode="numeric" maxlength="8" placeholder="Ej: 50000" value="' + esc(form.cash) + '"></div>' : '') +
      '<div class="fld"><label for="f-notes">Comentarios <span class="opt-l">(opcional)</span></label><textarea class="in" id="f-notes" data-fld="notes" rows="2" maxlength="200" placeholder="Ej: tocar el timbre, sin servilletas">' + esc(form.notes) + '</textarea></div>' +
      '</section>';
  }
  function bodyHTML() {
    if (!cart.length) return '<div class="empty-cart"><h3>Tu pedido está vacío</h3><p>Agrega pizzas, bebidas o postres desde el menú.</p><button class="btn" type="button" data-act="close-cart">Ver el menú</button></div>';
    return '<ul class="lines">' + cart.map(lineHTML).join('') + '</ul>' + formHTML();
  }
  function footHTML() {
    if (!cart.length) return '';
    var domi = form.type === 'domicilio';
    return '<div class="tot"><span>Total</span><strong>' + money(cartTotal()) + '</strong></div>' +
      (domi ? '<p class="tot-note">El domicilio no está incluido; te confirmamos su valor por WhatsApp.</p>' : '') +
      '<button class="btn primary big" type="button" data-act="send">' + (waNum ? 'Enviar pedido por WhatsApp' : 'Copiar pedido') + '</button>' +
      (waNum ? '' : '<p class="tot-note">Copia el pedido y pégalo en el chat del restaurante.</p>') +
      (ui.confirmClear
        ? '<div class="confirm"><span>¿Vaciar todo el pedido?</span><button type="button" class="lnk del" data-act="clear-yes" data-f="cy">Sí, vaciar</button><button type="button" class="lnk" data-act="clear-no" data-f="cn">No</button></div>'
        : '<button type="button" class="lnk center" data-act="clear" data-f="cl">Vaciar pedido</button>');
  }
  function pageHTML() {
    return '<header class="top"><p class="eyebrow">' + esc(biz.hours) + '</p>' +
      '<h1>' + esc(biz.name) + '</h1><p class="tagline">' + esc(biz.tagline) + '</p><p class="addr">' + esc(biz.address) + '</p></header>' +
      '<div class="bar" id="bar"><label class="search"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>' +
      '<input id="q" type="search" placeholder="Buscar pizza, bebida o ingrediente" autocomplete="off" aria-label="Buscar en el menú" value="' + esc(ui.q) + '"></label>' +
      '<nav class="chips" id="chips" aria-label="Categorías"></nav></div>' +
      '<div class="filters" id="filters"></div><main id="list"></main>' +
      '<div class="cartbar" id="cartbar" hidden><button type="button" class="cartbar-btn" data-act="open-cart"><span class="cb-n" id="cb-n"></span><span class="cb-l">Ver mi pedido</span><span class="cb-t" id="cb-t"></span></button></div>' +
      '<div class="scrim" id="scrim" data-act="close-cart" hidden></div>' +
      '<section class="sheet" id="sheet" role="dialog" aria-modal="true" aria-labelledby="sheet-t" hidden>' +
      '<header class="sheet-h"><h2 id="sheet-t">Tu pedido</h2><button type="button" class="x" id="sheet-x" data-act="close-cart" aria-label="Cerrar pedido">×</button></header>' +
      '<div class="sheet-b" id="sheet-b"></div><footer class="sheet-f" id="sheet-f"></footer></section>' +
      '<div class="toast" id="toast" role="status" aria-live="polite" hidden></div>';
  }

  /* ---------- Render ---------- */
  function measure() {
    var bar = $('#bar');
    if (bar) document.documentElement.style.setProperty('--bar-h', bar.offsetHeight + 'px');
  }
  function renderChips() { var e = $('#chips'); if (e) e.innerHTML = chipsHTML(); measure(); }
  function renderFilters() { var e = $('#filters'); if (e) e.innerHTML = filtersHTML(); }
  function renderList() { var e = $('#list'); if (e) e.innerHTML = listHTML(); }
  function markChip() {
    var box = $('#chips'); if (!box) return;
    $$('.chip-b', box).forEach(function (b) {
      var on = b.dataset.cat === ui.cat;
      b.classList.toggle('on', on);
      if (on) {
        var bl = b.getBoundingClientRect(), xl = box.getBoundingClientRect();
        if (bl.left < xl.left || bl.right > xl.right) {
          box.scrollTo({ left: Math.max(0, bl.left - xl.left + box.scrollLeft - 16), behavior: reduce ? 'auto' : 'smooth' });
        }
      }
    });
  }
  function refocus(f) {
    if (!f) return;
    var els = $$('[data-f]'), tries = [f];
    if (f.indexOf('d|') === 0) tries.push('q|' + f.slice(2));     // al llegar a 0 el stepper vuelve a ser «Agregar»
    for (var t = 0; t < tries.length; t++) for (var i = 0; i < els.length; i++) if (els[i].dataset.f === tries[t] && !els[i].disabled) { els[i].focus(); return; }
  }
  function curFocus() { var a = document.activeElement; return a && a.dataset ? a.dataset.f : null; }
  function refreshItem(id) {
    var p = byId[id];
    $$('.item').forEach(function (el) {
      if (el.dataset.id !== id) return;
      var t = document.createElement('div'); t.innerHTML = itemHTML(p);
      el.parentNode.replaceChild(t.firstChild, el);
    });
  }
  function updateBar() {
    var n = cartCount(), bar = $('#cartbar');
    if (!bar) return;
    bar.hidden = n === 0 || ui.open;
    $('#cb-n').textContent = n;
    $('#cb-t').textContent = money(cartTotal());
    document.body.classList.toggle('has-cart', n > 0);
  }
  function renderSheet(focusKey) {
    var sb = $('#sheet-b'), top = sb.scrollTop, f = focusKey || curFocus();
    sb.innerHTML = bodyHTML();
    $('#sheet-f').innerHTML = footHTML();
    sb.scrollTop = top;
    refocus(f);
  }
  function cartChanged(ids, focusKey) {
    save(); updateBar();
    ids.forEach(refreshItem);
    if (ui.open) renderSheet(focusKey);
  }
  function toast(msg) {
    var t = $('#toast'); if (!t) return;
    t.textContent = msg; t.hidden = false;
    clearTimeout(toastT); toastT = setTimeout(function () { t.hidden = true; }, 2400);
  }

  function openCart() {
    ui.open = true; ui.tried = false; ui.confirmClear = false;
    lastFocus = document.activeElement;
    renderSheet('none');
    $('#scrim').hidden = false; $('#sheet').hidden = false;
    document.body.style.overflow = 'hidden';
    updateBar();
    try { history.pushState({ cart: 1 }, ''); } catch (e) { /* ok */ }
    $('#sheet-x').focus();
  }
  function closeCart(fromPop) {
    if (!ui.open) return;
    ui.open = false;
    $('#scrim').hidden = true; $('#sheet').hidden = true;
    document.body.style.overflow = '';
    updateBar();
    if (!fromPop) { try { if (history.state && history.state.cart) history.back(); } catch (e) { /* ok */ } }
    if (lastFocus && lastFocus.focus && document.contains(lastFocus)) lastFocus.focus();
    else { var b = $('.cartbar-btn'); if (b && !$('#cartbar').hidden) b.focus(); }
  }
  function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(text);
    return new Promise(function (ok, fail) {
      var ta = document.createElement('textarea');
      ta.value = text; ta.setAttribute('readonly', ''); ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0';
      document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy') ? ok() : fail(); } catch (e) { fail(e); }
      document.body.removeChild(ta);
    });
  }
  function emptyCartAfterSend() {
    var ids = [];
    cart.forEach(function (l) { ids = ids.concat(touched(l.id, lineKey(l))); });
    cart = []; ui.notes = {}; ui.confirmClear = false; ui.tried = false;
    cartChanged(ids.filter(function (v, i, a) { return a.indexOf(v) === i; }), 'none');
    closeCart();
  }
  function send() {
    ui.tried = true;
    var bad = !form.type ? 'type' : !form.name.trim() ? 'name' : (form.type === 'domicilio' && !form.address.trim() ? 'address' : !form.pay ? 'pay' : '');
    if (bad) {
      renderSheet('none');
      var el = bad === 'type' ? $('[data-act="dt"]') : bad === 'pay' ? $('[data-act="py"]') : $('#f-' + bad);
      if (el) { el.focus(); el.scrollIntoView({ block: 'center', behavior: reduce ? 'auto' : 'smooth' }); }
      return;
    }
    var msg = message();
    if (waNum) {
      var a = document.createElement('a');
      a.href = 'https://wa.me/' + waNum + '?text=' + encodeURIComponent(msg);
      a.target = '_blank'; a.rel = 'noopener';
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      emptyCartAfterSend();
      toast('Pedido enviado. ¡Gracias!');
    } else {
      copyText(msg).then(function () {
        emptyCartAfterSend();
        toast('Pedido copiado. Pégalo en el chat.');
      }, function () { toast('No se pudo copiar el pedido. Intenta de nuevo.'); });
    }
  }

  /* ---------- Eventos ---------- */
  var ticking = false;
  window.addEventListener('scroll', function () {
    if (ticking) return; ticking = true;
    requestAnimationFrame(function () {
      ticking = false;
      var bar = $('#bar'); if (!bar || ui.open) return;
      var line = bar.getBoundingClientRect().bottom + 12, cur = null;
      $$('.cat').forEach(function (s) { if (s.getBoundingClientRect().top <= line) cur = s.dataset.sec; });
      if (!cur) { var f = $('.cat'); cur = f ? f.dataset.sec : null; }
      if (cur !== ui.cat) { ui.cat = cur; markChip(); }
    });
  }, { passive: true });
  window.addEventListener('resize', measure);
  window.addEventListener('popstate', function () { if (ui.open) closeCart(true); });
  document.addEventListener('keydown', function (e) {
    if (!ui.open) return;
    if (e.key === 'Escape') { e.preventDefault(); closeCart(); return; }
    if (e.key !== 'Tab') return;
    var f = $$('button:not([disabled]), input, textarea, summary, [href]', $('#sheet')).filter(function (x) { return x.offsetParent !== null; });
    if (!f.length) return;
    var first = f[0], last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  });

  function bump(t, delta) {
    var f = t.dataset.f, fl = t.dataset.fl || '';
    setQty(t.dataset.id, t.dataset.label, fl, delta);
    cartChanged(touched(t.dataset.id, fl), f); refocus(f);
  }

  var acts = {
    'cat': function (t) {
      ui.cat = t.dataset.cat; markChip();
      var s = $('.cat[data-sec="' + (window.CSS && CSS.escape ? CSS.escape(ui.cat) : ui.cat) + '"]');
      if (s) s.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
    },
    'size': function (t) { ui.size = t.dataset.size || ''; ui.sel = {}; renderFilters(); renderList(); },
    'fveg': function () { ui.fVeg = !ui.fVeg; renderChips(); renderFilters(); renderList(); },
    'fhot': function () { ui.fHot = !ui.fHot; renderChips(); renderFilters(); renderList(); },
    'clear-filters': function () {
      ui.q = ''; ui.fVeg = false; ui.fHot = false; ui.size = ''; ui.sel = {};
      var q = $('#q'); if (q) q.value = '';
      renderChips(); renderFilters(); renderList();
    },
    'mode': function (t) {
      var p = byId[t.dataset.id]; if (!p) return;
      var c = cfgOf(p); c.half = t.dataset.v === 'half'; if (!c.half) c.f2 = '';
      refreshItem(p.id); refocus(t.dataset.f);
    },
    'pick': function (t) { ui.sel[t.dataset.id] = t.dataset.label; refreshItem(t.dataset.id); var n = $$('.price.on').filter(function (x) { return x.dataset.id === t.dataset.id; })[0]; if (n) n.focus(); },
    'inc': function (t) { bump(t, 1); },
    'dec': function (t) { bump(t, -1); },
    'rm': function (t) {
      var fl = t.dataset.fl || '', i = find(t.dataset.id, t.dataset.label, fl);
      if (i > -1) cart.splice(i, 1);
      cartChanged(touched(t.dataset.id, fl), 'none');
    },
    'lsize': function (t) {
      var id = t.dataset.id, from = t.dataset.label, to = t.dataset.to, fl = t.dataset.fl || '';
      if (from === to) return;
      var i = find(id, from, fl); if (i < 0) return;
      var l0 = cart[i], ex2 = (l0.ex || []).filter(function (x) { return exPrice(byEx[x], to) > 0; });   // adiciones que no existen en el nuevo tamaño se quitan
      var nk = flKey(l0.fl) + (ex2.length ? '~' + ex2.join('+') : '');
      if (find(id, to, nk) > -1) { cart.splice(i, 1); addLine(id, to, nk, l0.qty, l0.note); }       // ya existía ese tamaño: se juntan
      else { l0.label = to; l0.ex = ex2; }                                                          // si no, la línea conserva su lugar
      cartChanged(touched(id, fl), 'ls|' + id + '|' + to + '|' + nk + '|' + to);
    },
    'lextra': function (t) {
      var id = t.dataset.id, label = t.dataset.label, fk = t.dataset.fl || '', x = t.dataset.x;
      var i = find(id, label, fk); if (i < 0) return;
      var l = cart[i], ex = (l.ex || []).slice(), at = ex.indexOf(x);
      if (at > -1) ex.splice(at, 1); else ex.push(x);
      ex.sort(function (a, b) { return exOrder[a] - exOrder[b]; });
      var nk = flKey(l.fl) + (ex.length ? '~' + ex.join('+') : '');
      if (l.qty > 1) { l.qty--; addLine(id, label, nk, 1, l.note); }                 // la adición va solo a una unidad
      else if (find(id, label, nk) > -1) { cart.splice(i, 1); addLine(id, label, nk, 1, l.note); }
      else l.ex = ex;
      cartChanged(touched(id, fk), 'lx|' + id + '|' + label + '|' + nk + '|' + x);
    },
    'note': function (t) {
      var fl = t.dataset.fl || '', i = find(t.dataset.id, t.dataset.label, fl), key = t.dataset.id + '|' + t.dataset.label + '|' + fl;
      if (i < 0) return;
      if (cart[i].note || ui.notes[key]) { cart[i].note = ''; delete ui.notes[key]; save(); renderSheet('nb|' + key); }
      else { ui.notes[key] = true; renderSheet('n|' + key); }
    },
    'dt': function (t) { form.type = t.dataset.v; save(); renderSheet(); },
    'py': function (t) { form.pay = t.dataset.v; save(); renderSheet(); },
    'open-cart': openCart,
    'close-cart': function () { closeCart(); },
    'send': send,
    'clear': function () { ui.confirmClear = true; renderSheet('cy'); },
    'clear-no': function () { ui.confirmClear = false; renderSheet('cl'); },
    'clear-yes': function () {
      var ids = [];
      cart.forEach(function (l) { ids = ids.concat(touched(l.id, lineKey(l))); });
      cart = []; ui.notes = {}; ui.confirmClear = false;
      cartChanged(ids.filter(function (v, i, a) { return a.indexOf(v) === i; }), 'none');
    }
  };
  $app.addEventListener('click', function (e) {
    var t = e.target.closest('[data-act]'); if (!t || !$app.contains(t)) return;
    if (acts[t.dataset.act]) acts[t.dataset.act](t);
  });
  $app.addEventListener('input', function (e) {
    var t = e.target;
    if (t.id === 'q') { ui.q = t.value; renderChips(); renderList(); return; }
    if (t.dataset.fld) {
      var k = t.dataset.fld, v = t.value;
      if (k === 'cash') { v = v.replace(/\D/g, ''); if (v !== t.value) t.value = v; }
      form[k] = v; save();
      if (v.trim()) { var er = $('#e-' + k); if (er) er.hidden = true; t.removeAttribute('aria-invalid'); }
      var pv = $('#prev'); if (pv) pv.textContent = message();
    } else if (t.hasAttribute('data-note')) {
      var i = find(t.dataset.id, t.dataset.label, t.dataset.fl || '');
      if (i > -1) { cart[i].note = t.value; save(); var pv2 = $('#prev'); if (pv2) pv2.textContent = message(); }
    }
  });

  $app.addEventListener('change', function (e) {
    var t = e.target, p = t.dataset && t.dataset.sel ? byId[t.dataset.id] : null;
    if (!p) return;
    var c = cfgOf(p);
    c[t.dataset.sel] = t.value;
    if (t.dataset.sel === 'f1') c.f2 = '';
    refreshItem(p.id); refocus(t.dataset.f);
  });

  load();
  $app.innerHTML = pageHTML();
  renderChips(); renderFilters(); renderList(); measure(); updateBar();
})();
