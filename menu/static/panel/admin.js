/* Panel de administración del menú (versión Django).
   Lee los datos de /menu-data.js (que genera Django desde la base de datos), deja editar productos,
   precios, categorías y datos del negocio, y guarda con un POST a la API del panel. Los cambios se
   ven en el menú de los clientes apenas se guardan. El acceso es el inicio de sesión del admin de Django. */
(function () {
  'use strict';

  var STORE = 'pizzeria-menu-borrador';

  /* ---------- Utilidades ---------- */
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var esc = function (s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  };
  var clone = function (o) { return JSON.parse(JSON.stringify(o)); };
  var norm = function (s) { return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase(); };
  var uid = function (p) { return p + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); };
  var toInt = function (v) { return parseInt(String(v).replace(/\D/g, ''), 10) || 0; };
  var TAGS = { veg: 'Vegetariana', hot: 'Picante', fav: 'Favorita' };
  var $app = $('#app');

  /* ---------- Configuración que entrega Django ---------- */
  var CFG = {};
  try { CFG = JSON.parse(($('#panel-config') || {}).textContent || '{}'); } catch (x) {}
  if (!window.MENU_DATA || !CFG.api) {
    $app.innerHTML = '<div class="missing"><h1>No se pudieron cargar los datos del menú</h1>' +
      '<p>Recarga la página. Si sigue igual, revisa que el servidor de Django esté funcionando.</p></div>';
    return;
  }

  /* ---------- Estado ---------- */
  function fix(d) {
    d.business = d.business || {};
    d.sizes = d.sizes || [];
    d.categories = d.categories || [];
    d.extras = (d.extras || []).map(function (x) { x.avail = x.avail !== false; x.all = x.all !== false; x['for'] = Array.isArray(x['for']) ? x['for'] : []; return x; });
    d.pizzaPrices = d.pizzaPrices || {};
    d.pizzaPrices.clasica = d.pizzaPrices.clasica || [];
    d.pizzaPrices.premium = d.pizzaPrices.premium || [];
    d.products = (d.products || []).map(function (p) {
      var t = typeOfCat(d, p.cat);
      p.tags = p.tags || [];
      p.prices = (t === 'clasica' || t === 'premium') ? [] : ((p.prices && p.prices.length) ? p.prices : [{ label: '', price: 0 }]);
      if (t === 'combo') p.includes = Array.isArray(p.includes) ? p.includes : [];
      p.avail = p.avail !== false;
      p.desc = p.desc || '';
      return p;
    });
    return d;
  }
  function typeOfCat(d, id) {
    var c = (d.categories || []).filter(function (x) { return x.id === id; })[0];
    return (c && c.type) || '';
  }
  var CAT_TYPES = [['', 'Normal (un precio o por tamaño)'], ['clasica', 'Pizza clásica'], ['premium', 'Pizza premium'], ['combo', 'Combo (pizza + extras)']];
  var isPizzaT = function (t) { return t === 'clasica' || t === 'premium'; }
  var saved = fix(clone(window.MENU_DATA));
  var savedStr = JSON.stringify(saved);
  var draft = clone(saved);
  var ui = {
    tab: 'productos', msg: '', msgKind: '', saving: false,
    adminQ: '', filterCat: '', confirmDel: null, confirmDiscard: false, editing: null, catMsg: '',
    accMsg: '', accKind: ''
  };
  var isDirty = function () { return JSON.stringify(draft) !== savedStr; };
  var findP = function (id) { return draft.products.filter(function (p) { return p.id === id; })[0]; };

  // Recupera cambios de la sesión anterior que no se alcanzaron a guardar.
  try {
    var stash = localStorage.getItem(STORE);
    if (stash) {
      var back = fix(JSON.parse(stash));
      if (JSON.stringify(back) !== savedStr) {
        draft = back;
        ui.msg = 'Retomaste los cambios que dejaste sin guardar la última vez.';
      } else {
        localStorage.removeItem(STORE);
      }
    }
  } catch (x) {}

  function keepDraft() {
    try {
      if (isDirty()) localStorage.setItem(STORE, JSON.stringify(draft));
      else localStorage.removeItem(STORE);
    } catch (x) {}
  }

  /* ---------- Vistas ---------- */
  function dirtyHTML() {
    if (!isDirty()) return '<span class="status">Sin cambios por guardar</span>';
    if (ui.confirmDiscard) {
      return '<span class="status warn">¿Descartar todos los cambios?</span><button class="btn small danger" type="button" data-act="discard-yes">Sí, descartar</button>' +
        '<button class="btn small ghost" type="button" data-act="discard-no">Cancelar</button>';
    }
    return '<span class="status warn">Cambios sin guardar</span><button class="btn small ghost" type="button" data-act="discard">Descartar</button>';
  }
  function adminHTML() {
    return '<div class="adm-bar"><div class="adm-title"><strong>Administrar menú</strong><div class="dirty" id="dirtybox">' + dirtyHTML() + '</div></div>' +
      '<div class="adm-actions"><a class="btn" href="' + esc(CFG.menuUrl) + '" target="_blank" rel="noopener">Ver menú</a>' +
      '<button class="btn primary" id="savebtn" type="button" data-act="save"' + (isDirty() && !ui.saving ? '' : ' disabled') + '>Guardar menú</button>' +
      '<button class="btn ghost" type="button" data-act="logout">Salir</button></div></div>' +
      '<p class="howto">Sesión: <strong>' + esc(CFG.user) + '</strong>. Al pulsar «Guardar menú» los cambios se publican al instante. ' +
      '<a href="' + esc(CFG.passwordUrl) + '">Cambiar mi contraseña</a></p>' +
      '<p class="msg ' + esc(ui.msgKind) + '" id="pubmsg" role="status">' + esc(ui.msg) + '</p>' +
      '<div class="tabs" role="tablist">' + [['productos', 'Productos'], ['pizzas', 'Precios de pizzas'], ['extras', 'Adiciones'], ['categorias', 'Categorías'], ['negocio', 'Negocio y tamaños']].map(function (t) {
        return '<button class="tab" role="tab" type="button" data-act="tab" data-tab="' + t[0] + '" aria-selected="' + (ui.tab === t[0]) + '">' + t[1] + '</button>';
      }).join('') + '</div><div id="tabbody">' + tabHTML() + '</div><div id="modal">' + modalHTML() + '</div>';
  }
  function tabHTML() {
    if (ui.tab === 'categorias') return catsTab();
    if (ui.tab === 'pizzas') return pizzasTab();
    if (ui.tab === 'extras') return extrasTab();
    if (ui.tab === 'negocio') return bizTab();
    return prodsTab();
  }
  function prodsTab() {
    return '<div class="tools"><input class="grow" id="aq" type="search" placeholder="Buscar producto" aria-label="Buscar producto" value="' + esc(ui.adminQ) + '">' +
      '<select id="fcat" aria-label="Filtrar por categoría" style="flex:0 1 14rem"><option value="">Todas las categorías</option>' +
      draft.categories.map(function (c) { return '<option value="' + esc(c.id) + '"' + (ui.filterCat === c.id ? ' selected' : '') + '>' + esc(c.name) + '</option>'; }).join('') +
      '</select><button class="btn primary" type="button" data-act="new-product">Nuevo producto</button></div><div id="plist">' + plistHTML() + '</div>';
  }
  function plistHTML() {
    var q = norm(ui.adminQ), out = '';
    draft.categories.forEach(function (c) {
      if (ui.filterCat && ui.filterCat !== c.id) return;
      var items = draft.products.filter(function (p) { return p.cat === c.id && (!q || norm(p.name).indexOf(q) > -1); });
      if (!items.length) return;
      out += '<section class="agroup"><h3>' + esc(c.name) + '<span class="count">' + items.length + '</span></h3>' + items.map(arowHTML).join('') + '</section>';
    });
    return out || '<p class="hint" style="margin-top:24px">No hay productos que coincidan. Usa «Nuevo producto» para agregar uno.</p>';
  }
  function arowHTML(p) {
    var pizza = isPizzaT(typeOfCat(draft, p.cat));
    var pins = pizza ? '<p class="hint">El precio depende del tamaño y de si es clásica o premium. Se cambia en la pestaña «Precios de pizzas».</p>' : p.prices.map(function (x, i) {
      return '<label class="pin">' + (x.label ? esc(x.label) : 'Precio') + '<span class="money"><i>$</i><input inputmode="numeric" autocomplete="off" data-pp="' + esc(p.id) + '" data-i="' + i + '" value="' + (x.price || '') + '" aria-label="Precio ' + esc(p.name) + ' ' + esc(x.label) + '"></span></label>';
    }).join('');
    var foot = ui.confirmDel === p.id
      ? '<div class="confirm"><span>¿Eliminar «' + esc(p.name) + '»?</span><button class="btn small danger" type="button" data-act="del-yes" data-id="' + esc(p.id) + '">Sí, eliminar</button><button class="btn small ghost" type="button" data-act="del-no">Cancelar</button></div>'
      : '<button class="btn small" type="button" data-act="edit-product" data-id="' + esc(p.id) + '">Editar</button>' +
        '<button class="btn small ghost" type="button" data-act="mv" data-dir="-1" data-id="' + esc(p.id) + '" aria-label="Subir ' + esc(p.name) + '">Subir</button>' +
        '<button class="btn small ghost" type="button" data-act="mv" data-dir="1" data-id="' + esc(p.id) + '" aria-label="Bajar ' + esc(p.name) + '">Bajar</button>' +
        '<span class="sp"></span><button class="btn small ghost danger" type="button" data-act="del-ask" data-id="' + esc(p.id) + '">Eliminar</button>';
    return '<div class="arow' + (p.avail ? '' : ' out') + '" data-row="' + esc(p.id) + '"><div class="arow-head"><strong>' + esc(p.name) + '</strong>' +
      '<label class="sw"><input type="checkbox" data-avail="' + esc(p.id) + '"' + (p.avail ? ' checked' : '') + '><span class="track"></span><span>Disponible</span></label></div>' +
      '<div class="pins">' + pins + '</div><div class="arow-foot">' + foot + '</div></div>';
  }
  function catsTab() {
    return '<div class="panel"><h3>Categorías</h3><p class="hint">Así se ordenan las secciones del menú. Una categoría solo se puede eliminar cuando no tiene productos. El <strong>tipo</strong> define cómo se vende: las categorías de pizza clásica y premium dejan elegir uno o dos sabores y usan los precios de la pestaña «Precios de pizzas»; en un combo el cliente elige tamaño y sabor de la pizza.</p>' +
      draft.categories.map(function (c) {
        var n = draft.products.filter(function (p) { return p.cat === c.id; }).length;
        return '<div class="crow"><input data-cf="' + esc(c.id) + '" value="' + esc(c.name) + '" aria-label="Nombre de la categoría"><span class="muted">' + n + (n === 1 ? ' producto' : ' productos') + '</span>' +
          '<div class="cmeta"><select data-ct="' + esc(c.id) + '" aria-label="Tipo de la categoría">' + CAT_TYPES.map(function (t) {
            return '<option value="' + t[0] + '"' + ((c.type || '') === t[0] ? ' selected' : '') + '>' + t[1] + '</option>';
          }).join('') + '</select><button class="btn small ghost" type="button" data-act="cmv" data-dir="-1" data-id="' + esc(c.id) + '">Subir</button>' +
          '<button class="btn small ghost" type="button" data-act="cmv" data-dir="1" data-id="' + esc(c.id) + '">Bajar</button>' +
          '<button class="btn small ghost danger" type="button" data-act="cdel" data-id="' + esc(c.id) + '">Eliminar</button></div></div>';
      }).join('') +
      '<p class="msg err" id="catmsg" role="status">' + esc(ui.catMsg) + '</p>' +
      '<div class="crow"><input id="newcat" placeholder="Nueva categoría (ej. Calzones)" aria-label="Nueva categoría"><button class="btn primary" type="button" data-act="cadd">Agregar</button></div></div>';
  }
  function extrasTab() {
    return '<div class="panel"><h3>Adiciones</h3><p class="hint">Extras con precio que el cliente puede sumar a una pizza o a un combo (queso extra, tocineta, borde relleno…). El precio es el mismo para todos los tamaños. Cada adición puede aplicar a todas las pizzas o solo a las que tú marques (por ejemplo, tocineta solo en las que ya la llevan). «Agotada» la oculta del menú sin borrarla.</p>' +
      draft.extras.map(function (x) {
        var id = esc(x.id);
        return '<div class="xitem"><div class="crow"><input data-xn="' + id + '" value="' + esc(x.name) + '" aria-label="Nombre de la adición">' +
          '<span class="money"><i>$</i><input inputmode="numeric" autocomplete="off" data-xp="' + id + '" value="' + (x.price || '') + '" aria-label="Precio de ' + esc(x.name) + '"></span>' +
          '<div class="cmeta"><button class="btn small ghost" type="button" data-act="xtoggle" data-id="' + id + '">' + (x.avail ? 'Disponible' : 'Agotada') + '</button>' +
          '<button class="btn small ghost" type="button" data-act="xmv" data-dir="-1" data-id="' + id + '">Subir</button>' +
          '<button class="btn small ghost" type="button" data-act="xmv" data-dir="1" data-id="' + id + '">Bajar</button>' +
          '<button class="btn small ghost danger" type="button" data-act="xdel" data-id="' + id + '">Eliminar</button></div></div>' + xapplyHTML(x) + '</div>';
      }).join('') +
      '<p class="msg err" id="xmsg" role="status">' + esc(ui.xMsg || '') + '</p>' +
      '<div class="crow"><input id="newxn" placeholder="Nueva adición (ej. Queso extra)" aria-label="Nueva adición">' +
      '<span class="money"><i>$</i><input id="newxp" inputmode="numeric" autocomplete="off" placeholder="Precio" aria-label="Precio de la nueva adición"></span>' +
      '<button class="btn primary" type="button" data-act="xadd">Agregar</button></div></div>';
  }
  function xapplyHTML(x) {
    var id = esc(x.id), h = '<div class="xapply"><label><input type="checkbox" data-xall="' + id + '"' + (x.all ? ' checked' : '') + '> Disponible en todas las pizzas</label>';
    if (!x.all) {
      var n = x['for'].length;
      h += '<details class="xlist"><summary>Elegir pizzas (' + n + ' marcada' + (n === 1 ? '' : 's') + ')</summary>' + draft.categories.filter(function (c) {
        return isPizzaT(c.type || '');
      }).map(function (c) {
        var items = draft.products.filter(function (p) { return p.cat === c.id; });
        if (!items.length) return '';
        return '<p class="muted">' + esc(c.name) + '</p>' + items.map(function (p) {
          return '<label class="xchk"><input type="checkbox" data-xfor="' + id + '" data-p="' + esc(p.id) + '"' + (x['for'].indexOf(p.id) > -1 ? ' checked' : '') + '> ' + esc(p.name) + '</label>';
        }).join('');
      }).join('') + '</details>';
    }
    return h + '</div>';
  }
  function tierPriceA(tier, size) {
    var a = draft.pizzaPrices[tier] || [];
    for (var i = 0; i < a.length; i++) if (a[i].label === size) return a[i].price;
    return 0;
  }
  var moneyFmt = function (n) { return '$' + String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, '.'); };
  function pizzasTab() {
    if (!draft.sizes.length) return '<div class="panel"><h3>Precios de pizzas</h3><p class="hint">Primero agrega los tamaños en la pestaña «Negocio y tamaños».</p></div>';
    var rows = draft.sizes.map(function (sz) {
      var c = tierPriceA('clasica', sz.name), p = tierPriceA('premium', sz.name), ok = c > 0 && p > 0;
      function inp(tier, v) {
        return '<span class="money"><i>$</i><input inputmode="numeric" autocomplete="off" data-zp="' + tier + '" data-size="' + esc(sz.name) + '" value="' + (v || '') + '" aria-label="Precio ' + tier + ' ' + esc(sz.name) + '"></span>';
      }
      return '<div class="zrow"><strong>' + esc(sz.name || '(sin nombre)') + '</strong>' +
        '<label class="pin">Clásica' + inp('clasica', c) + '</label><label class="pin">Premium' + inp('premium', p) + '</label>' +
        '<p class="hint zres" data-zres="' + esc(sz.name) + '">' + zresText(sz.name) + '</p></div>';
    }).join('');
    return '<div class="panel"><h3>Precios de pizzas</h3>' +
      '<p class="hint">Escribe el precio de una pizza de un solo sabor, clásica y premium, por cada tamaño. Con dos sabores el precio sale así: clásica + clásica = precio clásica; premium + clásica = precio premium; premium + premium = precio premium + (premium − clásica). Los combos suben igual respecto a su precio base. Si dejas un precio en 0, ese tamaño no se vende.</p>' + rows + '</div>';
  }
  function zresText(name) {
    var c = tierPriceA('clasica', name), p = tierPriceA('premium', name);
    if (!(c > 0 && p > 0)) return 'Llena los dos precios para vender este tamaño.';
    return 'Dos sabores: clásica + clásica ' + moneyFmt(c) + ' · premium + clásica ' + moneyFmt(p) + ' · premium + premium ' + moneyFmt(p + (p - c));
  }
  function bizTab() {
    var b = draft.business;
    function f(k, label, ph, hint) {
      return '<div class="field"><label for="b-' + k + '">' + label + '</label><input id="b-' + k + '" data-bf="' + k + '" value="' + esc(b[k]) + '" placeholder="' + esc(ph || '') + '" autocomplete="off">' + (hint ? '<p class="hint">' + hint + '</p>' : '') + '</div>';
    }
    return '<div class="panel"><h3>Datos del negocio</h3>' + f('name', 'Nombre', 'Nombre de la pizzería') + f('tagline', 'Frase corta', 'Una línea sobre tu pizzería') +
      f('hours', 'Horario', 'Todos los días · 12 m a 10 pm') + f('address', 'Dirección', 'Calle, barrio, ciudad') +
      f('whatsapp', 'WhatsApp para pedidos', '573001234567', 'Solo números, con el indicativo del país. Si lo dejas vacío, el cliente verá «Copiar pedido» en lugar de «Enviar pedido por WhatsApp».') + '</div>' +
      '<div class="panel"><h3>Tamaños</h3><p class="hint">Estos nombres aparecen en el selector «Tamaño» del menú. Si cambias un nombre, se actualiza en todos los productos.</p>' +
      draft.sizes.map(function (s, i) {
        return '<div class="srow"><input data-sn="' + i + '" data-old="' + esc(s.name) + '" value="' + esc(s.name) + '" aria-label="Nombre del tamaño" placeholder="Nombre">' +
          '<input data-sd="' + i + '" value="' + esc(s.detail) + '" aria-label="Detalle del tamaño" placeholder="30 cm · 6 porciones">' +
          '<button class="btn small ghost danger" type="button" data-act="size-del" data-i="' + i + '">Quitar</button></div>';
      }).join('') + '<div><button class="btn" type="button" data-act="size-add">Agregar tamaño</button></div></div>';
  }
  function modalHTML() {
    var e = ui.editing; if (!e) return '';
    var p = e.p, t = typeOfCat(draft, p.cat), pizza = isPizzaT(t), combo = t === 'combo';
    var rows = p.prices.map(function (x, i) {
      return '<div class="prow"><input list="size-list" data-ep="label" data-i="' + i + '" value="' + esc(x.label) + '" placeholder="Tamaño (ej. Mediana)" aria-label="Tamaño">' +
        '<span class="money"><i>$</i><input inputmode="numeric" autocomplete="off" data-ep="price" data-i="' + i + '" value="' + (x.price || '') + '" aria-label="Precio"></span>' +
        '<button class="btn small ghost danger" type="button" data-act="rm-price" data-i="' + i + '">Quitar</button></div>';
    }).join('');
    return '<div class="modal"><div class="sheet" id="sheet" role="dialog" aria-modal="true" aria-labelledby="mt"><h2 id="mt">' + (e.isNew ? 'Nuevo producto' : 'Editar producto') + '</h2>' +
      '<div class="field"><label for="e-name">Nombre</label><input id="e-name" data-ef="name" value="' + esc(p.name) + '" autocomplete="off"></div>' +
      '<div class="field"><label for="e-cat">Categoría</label><select id="e-cat" data-ef="cat">' + draft.categories.map(function (c) {
        return '<option value="' + esc(c.id) + '"' + (p.cat === c.id ? ' selected' : '') + '>' + esc(c.name) + '</option>';
      }).join('') + '</select></div>' +
      '<div class="field"><label for="e-desc">Descripción</label><textarea id="e-desc" data-ef="desc" rows="3">' + esc(p.desc) + '</textarea></div>' +
      '<fieldset class="field"><legend>Etiquetas</legend><div class="checks">' + Object.keys(TAGS).map(function (t) {
        return '<label><input type="checkbox" data-etag="' + t + '"' + (p.tags.indexOf(t) > -1 ? ' checked' : '') + '>' + TAGS[t] + '</label>';
      }).join('') + '</div></fieldset>' +
      (pizza ? '<p class="hint">Las pizzas no llevan precio propio: se cobra según el tamaño y si es clásica o premium. Los precios están en la pestaña «Precios de pizzas».</p>' :
      (combo ? '<div class="field"><label for="e-inc">Incluye (uno por línea)</label><textarea id="e-inc" data-einc rows="3" placeholder="Deditos de queso&#10;Gaseosa">' + esc(e.inc) + '</textarea><p class="hint">La pizza (uno o dos sabores) siempre va incluida; aquí pones lo demás.</p></div>' : '') +
      '<fieldset class="field"><legend>' + (combo ? 'Precio base por tamaño' : 'Precios') + '</legend><p class="hint">' + (combo ? 'Es el precio con una pizza clásica. Si el cliente elige sabores premium, se suma la diferencia automáticamente.' : 'Un precio por tamaño, o un solo precio con el tamaño vacío (bebidas, entradas).') + '</p>' + rows +
      '<datalist id="size-list">' + draft.sizes.map(function (s) { return '<option value="' + esc(s.name) + '">'; }).join('') + '</datalist>' +
      '<div><button class="btn small" type="button" data-act="add-price">Agregar tamaño</button></div></fieldset>') +
      '<label class="sw"><input type="checkbox" data-eavail' + (p.avail ? ' checked' : '') + '><span class="track"></span><span>Disponible hoy</span></label>' +
      '<p class="msg err" id="e-err" role="alert"></p>' +
      '<div class="sheet-actions"><button class="btn" type="button" data-act="cancel-edit">Cancelar</button><button class="btn primary" type="button" data-act="save-product">Guardar producto</button></div></div></div>';
  }
  function renderModal(keepScroll) {
    var m = $('#modal'); if (!m) return;
    var sh = $('#sheet'), st = sh ? sh.scrollTop : 0;
    m.innerHTML = modalHTML();
    if (keepScroll) { var n = $('#sheet'); if (n) n.scrollTop = st; }
  }
  function renderTab() { var t = $('#tabbody'); if (t) t.innerHTML = tabHTML(); }
  function updateChrome() {
    keepDraft();
    var box = $('#dirtybox'); if (box) box.innerHTML = dirtyHTML();
    var b = $('#savebtn'); if (b) b.disabled = !isDirty() || ui.saving;
  }
  function setMsg(t, kind) {
    ui.msg = t; ui.msgKind = kind || '';
    var m = $('#pubmsg'); if (m) { m.textContent = t; m.className = 'msg ' + (kind || ''); }
  }
  function render() { $app.innerHTML = adminHTML(); }

  /* ---------- Guardar en el servidor ---------- */
  function afterSave(message, data) {
    saved = fix(clone(data)); savedStr = JSON.stringify(saved); draft = clone(saved);
    ui.saving = false; ui.confirmDiscard = false;
    ui.msg = message; ui.msgKind = 'ok';
    render(); keepDraft();
  }
  async function saveMenu() {
    if (ui.saving || !isDirty()) return;
    ui.saving = true; updateChrome();
    try {
      var r = await fetch(CFG.api, {
        method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', 'X-CSRFToken': CFG.csrf },
        body: JSON.stringify(draft)
      });
      var j = {};
      try { j = await r.json(); } catch (x) { /* respuesta sin JSON */ }
      if (r.ok && j.data) { afterSave('Guardado. El menú de los clientes ya muestra los cambios.', j.data); return; }
      ui.saving = false;
      if (r.status === 401 || r.status === 403) setMsg((j.error || 'Sin permiso') + ' Recarga la página e inicia sesión de nuevo; tus cambios sin guardar se conservan.', 'err');
      else setMsg(j.error || 'No se pudo guardar. Intenta de nuevo.', 'err');
    } catch (err) {
      ui.saving = false; setMsg('No hay conexión con el servidor. Intenta de nuevo.', 'err');
    }
    updateChrome();
  }

  /* ---------- Acciones ---------- */
  function moveIn(arr, i, dir, same) {
    var j = i + dir;
    while (j >= 0 && j < arr.length && !same(arr[i], arr[j])) j += dir;
    if (j < 0 || j >= arr.length) return;
    var t = arr[i]; arr[i] = arr[j]; arr[j] = t;
  }
  function saveEditing() {
    var e = ui.editing, p = e.p, err = $('#e-err');
    function bad(m) { if (err) err.textContent = m; }
    p.name = String(p.name || '').trim();
    if (!p.name) return bad('Escribe el nombre del producto.');
    if (!p.cat && draft.categories.length) p.cat = draft.categories[0].id;
    var t = typeOfCat(draft, p.cat);
    if (isPizzaT(t)) {
      p.prices = [];
    } else {
      p.prices = p.prices.map(function (x) { return { label: String(x.label || '').trim(), price: toInt(x.price) }; });
      if (!p.prices.length) return bad('Agrega al menos un precio.');
      if (p.prices.some(function (x) { return !(x.price > 0); })) return bad('Cada precio debe ser mayor que cero.');
      if ((p.prices.length > 1 || t === 'combo') && p.prices.some(function (x) { return !x.label; })) return bad('Con varios precios, cada uno necesita su tamaño.');
    }
    if (t === 'combo') p.includes = String(e.inc || '').split('\n').map(function (x) { return x.trim(); }).filter(Boolean);
    else delete p.includes;
    var i = draft.products.findIndex(function (x) { return x.id === p.id; });
    function insertInCat() {
      var last = -1;
      draft.products.forEach(function (x, k) { if (x.cat === p.cat) last = k; });
      draft.products.splice(last < 0 ? draft.products.length : last + 1, 0, p);
    }
    if (e.isNew || i < 0) {
      insertInCat();
    } else if (draft.products[i].cat !== p.cat) {
      draft.products.splice(i, 1); insertInCat();
    } else {
      draft.products[i] = p;
    }
    ui.editing = null; renderModal(); renderTab(); updateChrome();
  }

  function defaultPrices(t) {
    return (t === 'combo' && draft.sizes.length) ? draft.sizes.map(function (s) { return { label: s.name, price: 0 }; }) : [{ label: '', price: 0 }];
  }
  var acts = {
    'tab': function (t) { ui.tab = t.dataset.tab; ui.confirmDel = null; render(); },
    'new-product': function () {
      var cid = ui.filterCat || (draft.categories[0] && draft.categories[0].id) || '';
      var cat = draft.categories.filter(function (c) { return c.id === cid; })[0];
      var t = (cat && cat.type) || '';
      ui.editing = {
        isNew: true, inc: '',
        p: {
          id: uid('p'), cat: cid, name: '', desc: '', tags: [], avail: true,
          prices: defaultPrices(t)
        }
      };
      renderModal(); var n = $('#e-name'); if (n) n.focus();
    },
    'edit-product': function (t) {
      var p = findP(t.dataset.id); if (!p) return;
      ui.editing = { isNew: false, p: clone(p), inc: (p.includes || []).join('\n') }; renderModal();
    },
    'cancel-edit': function () { ui.editing = null; renderModal(); },
    'save-product': saveEditing,
    'add-price': function () {
      ui.editing.p.prices.push({ label: '', price: 0 }); renderModal(true);
      var rows = $$('.prow input[data-ep="label"]'); if (rows.length) rows[rows.length - 1].focus();
    },
    'rm-price': function (t) {
      var ps = ui.editing.p.prices; if (ps.length > 1) { ps.splice(+t.dataset.i, 1); renderModal(true); }
    },
    'mv': function (t) {
      var i = draft.products.findIndex(function (p) { return p.id === t.dataset.id; });
      moveIn(draft.products, i, +t.dataset.dir, function (a, b) { return a.cat === b.cat; });
      renderTab(); updateChrome();
    },
    'del-ask': function (t) { ui.confirmDel = t.dataset.id; renderTab(); },
    'del-no': function () { ui.confirmDel = null; renderTab(); },
    'del-yes': function (t) {
      draft.products = draft.products.filter(function (p) { return p.id !== t.dataset.id; });
      ui.confirmDel = null; renderTab(); updateChrome();
    },
    'cmv': function (t) {
      var i = draft.categories.findIndex(function (c) { return c.id === t.dataset.id; });
      moveIn(draft.categories, i, +t.dataset.dir, function () { return true; });
      renderTab(); updateChrome();
    },
    'cdel': function (t) {
      var n = draft.products.filter(function (p) { return p.cat === t.dataset.id; }).length;
      if (n) { ui.catMsg = 'Esa categoría todavía tiene ' + n + (n === 1 ? ' producto' : ' productos') + '. Muévelos o elimínalos primero.'; renderTab(); return; }
      ui.catMsg = '';
      draft.categories = draft.categories.filter(function (c) { return c.id !== t.dataset.id; });
      renderTab(); updateChrome();
    },
    'cadd': function () {
      var inp = $('#newcat'), v = inp ? inp.value.trim() : '';
      if (!v) { ui.catMsg = 'Escribe el nombre de la categoría.'; var m = $('#catmsg'); if (m) m.textContent = ui.catMsg; return; }
      ui.catMsg = ''; draft.categories.push({ id: uid('c'), name: v }); renderTab(); updateChrome();
    },
    'xadd': function () {
      var n = $('#newxn'), pr = $('#newxp'), name = n ? n.value.trim() : '', price = pr ? toInt(pr.value) : 0;
      if (!name || !(price > 0)) { ui.xMsg = 'Escribe el nombre y un precio mayor que cero.'; var m = $('#xmsg'); if (m) m.textContent = ui.xMsg; return; }
      ui.xMsg = ''; draft.extras.push({ id: uid('x'), name: name, price: price, avail: true }); renderTab(); updateChrome();
    },
    'xdel': function (t) { draft.extras = draft.extras.filter(function (x) { return x.id !== t.dataset.id; }); renderTab(); updateChrome(); },
    'xtoggle': function (t) {
      var x = draft.extras.filter(function (k) { return k.id === t.dataset.id; })[0];
      if (x) { x.avail = !x.avail; renderTab(); updateChrome(); }
    },
    'xmv': function (t) {
      var i = draft.extras.findIndex(function (x) { return x.id === t.dataset.id; });
      moveIn(draft.extras, i, +t.dataset.dir, function () { return true; });
      renderTab(); updateChrome();
    },
    'size-add': function () { draft.sizes.push({ name: '', detail: '' }); renderTab(); updateChrome(); },
    'size-del': function (t) { draft.sizes.splice(+t.dataset.i, 1); renderTab(); updateChrome(); },
    'discard': function () { ui.confirmDiscard = true; updateChrome(); },
    'discard-no': function () { ui.confirmDiscard = false; updateChrome(); },
    'discard-yes': function () {
      draft = clone(saved); ui.confirmDiscard = false; ui.editing = null; ui.confirmDel = null;
      ui.msg = 'Se descartaron los cambios.'; ui.msgKind = ''; render(); keepDraft();
    },
    'save': saveMenu,
    'logout': async function () {
      try { await fetch(CFG.logout, { method: 'POST', credentials: 'same-origin', headers: { 'X-CSRFToken': CFG.csrf } }); } catch (x) { /* se recarga igual */ }
      location.href = CFG.menuUrl;
    }
  };
  $app.addEventListener('click', function (e) {
    var t = e.target.closest('[data-act]'); if (!t || !$app.contains(t)) return;
    if (acts[t.dataset.act]) acts[t.dataset.act](t, e);
  });

  $app.addEventListener('input', function (e) {
    var t = e.target, d = t.dataset;
    if (d.einc !== undefined && ui.editing) { ui.editing.inc = t.value; return; }
    if (d.zp) {
      var arr = draft.pizzaPrices[d.zp], it = arr.filter(function (x) { return x.label === d.size; })[0], v = toInt(t.value);
      if (it) it.price = v; else arr.push({ label: d.size, price: v });
      var r = $('[data-zres="' + (window.CSS && CSS.escape ? CSS.escape(d.size) : d.size) + '"]'); if (r) r.textContent = zresText(d.size);
      updateChrome(); return;
    }
    if (t.id === 'aq') { ui.adminQ = t.value; var pl = $('#plist'); if (pl) pl.innerHTML = plistHTML(); return; }
    if (d.pp) {
      var p = findP(d.pp); if (p && p.prices[+d.i]) { p.prices[+d.i].price = toInt(t.value); updateChrome(); }
      return;
    }
    if (d.ef && ui.editing) { ui.editing.p[d.ef] = t.value; return; }
    if (d.ep && ui.editing) {
      var x = ui.editing.p.prices[+d.i]; if (x) x[d.ep] = d.ep === 'price' ? toInt(t.value) : t.value;
      return;
    }
    if (d.xn || d.xp) {
      var xx = draft.extras.filter(function (k) { return k.id === (d.xn || d.xp); })[0];
      if (xx) { if (d.xn) xx.name = t.value; else xx.price = toInt(t.value); updateChrome(); }
      return;
    }
    if (d.cf) { var c = draft.categories.filter(function (k) { return k.id === d.cf; })[0]; if (c) { c.name = t.value; updateChrome(); } return; }
    if (d.bf) { draft.business[d.bf] = t.value; updateChrome(); return; }
    if (d.sd !== undefined) { draft.sizes[+d.sd].detail = t.value; updateChrome(); return; }
    if (d.sn !== undefined) { draft.sizes[+d.sn].name = t.value; updateChrome(); return; }
  });
  $app.addEventListener('change', function (e) {
    var t = e.target, d = t.dataset;
    if (t.id === 'fcat') { ui.filterCat = t.value; var pl = $('#plist'); if (pl) pl.innerHTML = plistHTML(); return; }
    if (d.avail) {
      var p = findP(d.avail);
      if (p) { p.avail = t.checked; var row = t.closest('.arow'); if (row) row.classList.toggle('out', !t.checked); updateChrome(); }
      return;
    }
    if (d.xall || d.xfor) {
      var xe = draft.extras.filter(function (k) { return k.id === (d.xall || d.xfor); })[0];
      if (xe) {
        if (d.xall) { xe.all = t.checked; renderTab(); }
        else { var at = xe['for'].indexOf(d.p); if (t.checked && at < 0) xe['for'].push(d.p); else if (!t.checked && at > -1) xe['for'].splice(at, 1); }
        updateChrome();
      }
      return;
    }
    if (d.ct) {
      var cc = draft.categories.filter(function (k) { return k.id === d.ct; })[0];
      if (cc) {
        if (t.value) cc.type = t.value; else delete cc.type;
        var nt = t.value;
        draft.products.forEach(function (p) {
          if (p.cat !== cc.id) return;
          if (isPizzaT(nt)) p.prices = [];
          else if (!p.prices.length || (nt === 'combo' && p.prices.length === 1 && !p.prices[0].label)) p.prices = defaultPrices(nt);
          if (nt === 'combo') p.includes = p.includes || []; else delete p.includes;
        });
        updateChrome();
      }
      return;
    }
    if (d.ef === 'cat' && ui.editing) {
      var ed = ui.editing, nt2 = typeOfCat(draft, t.value);
      ed.p.cat = t.value;
      if (!isPizzaT(nt2) && !ed.p.prices.length) ed.p.prices = defaultPrices(nt2);
      if (nt2 === 'combo' && ed.p.prices.length === 1 && !ed.p.prices[0].label) ed.p.prices = defaultPrices(nt2);
      renderModal(true); return;
    }
    if (d.etag && ui.editing) {
      var tg = ui.editing.p.tags, i = tg.indexOf(d.etag);
      if (t.checked && i < 0) tg.push(d.etag);
      if (!t.checked && i > -1) tg.splice(i, 1);
      return;
    }
    if (t.hasAttribute('data-eavail') && ui.editing) { ui.editing.p.avail = t.checked; return; }
    if (d.sn !== undefined) {
      var old = d.old, nu = t.value.trim();
      if (old && nu && nu !== old) {
        draft.products.forEach(function (p) { p.prices.forEach(function (x) { if (x.label === old) x.label = nu; }); });
        ['clasica', 'premium'].forEach(function (k) { draft.pizzaPrices[k].forEach(function (x) { if (x.label === old) x.label = nu; }); });
      }
      t.dataset.old = nu; draft.sizes[+d.sn].name = nu; updateChrome();
    }
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && ui.editing) { ui.editing = null; renderModal(); }
  });

  render();
})();
