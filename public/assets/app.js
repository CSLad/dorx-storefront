/* DORX — поведение сайта.
 *
 * Один файл на все страницы: он сам смотрит, какие блоки есть в разметке,
 * и оживляет только их. Данные тянутся из трёх файлов, которые правит
 * админка, поэтому витрина всегда показывает то, что сохранил владелец.
 */
(function () {
  'use strict';

  var P = [];            /* товары */
  var CFG = {};          /* настройки сайта */
  var PROMOS = [];       /* акции-баннеры */

  var CATS = [
    { key: 'seating',    name: 'Кресла и мебель',  hint: 'Сидеть и работать' },
    { key: 'mirrors',    name: 'Зеркала',          hint: 'Свет и пространство' },
    { key: 'workspace',  name: 'Рабочее место',    hint: 'Стол и всё вокруг' },
    { key: 'appliances', name: 'Техника',          hint: 'Кухня и дом' },
    { key: 'bath',       name: 'Ванная',           hint: 'Порядок и уход' },
    { key: 'home',       name: 'Для дома',         hint: 'Мелочи, которые держат' }
  ];

  var FALLBACK = {
    phone: '+7 700 000 00 00',
    phoneTel: '+77000000000',
    brandLine: 'DORX · собственный бренд · Казахстан',
    heroTitle: 'BUILT|SHARP.',
    heroSub: 'Мебель и техника для дома и офиса под собственным брендом. Гарантия до 12 месяцев, доставка по всему Казахстану.',
    manifest: 'Свой бренд значит: сами выбираем материалы, сами держим склад и сами отвечаем, если что-то пошло не так.'
  };

  var XMARK = '<svg viewBox="0 0 100 100" aria-hidden="true">' +
    '<g transform="translate(50,50) skewX(-10) translate(-50,-50)" stroke="currentColor" ' +
    'stroke-width="22" stroke-linecap="butt">' +
    '<line x1="22" y1="22" x2="78" y2="78"></line>' +
    '<line x1="78" y1="22" x2="22" y2="78"></line></g></svg>';

  /* ---------- мелкие помощники ---------- */

  function $(id) { return document.getElementById(id); }
  function all(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function fmt(n) {
    return (Number(n) || 0).toLocaleString('ru-RU').replace(/[, ]/g, ' ') + ' ₸';
  }

  function j(url) {
    return fetch(url, { cache: 'no-store' }).then(function (r) {
      if (!r.ok) throw new Error(url + ' -> ' + r.status);
      return r.json();
    });
  }

  function catName(key) {
    for (var i = 0; i < CATS.length; i++) if (CATS[i].key === key) return CATS[i].name;
    return 'Прочее';
  }

  function lead(p) { return (p.images && p.images[0]) || ''; }

  /* ---------- загрузка данных ---------- */

  function normalise(list) {
    if (!Array.isArray(list)) return [];
    return list.filter(function (p) { return p && p.id && p.name; }).map(function (p) {
      var price = Math.max(0, parseInt(p.price, 10) || 0);
      return {
        id: String(p.id),
        name: String(p.name),
        sub: String(p.sub || ''),
        category: p.category || 'home',
        warranty: p.warranty || '',
        hit: Boolean(p.hit),
        isNew: Boolean(p.isNew),
        demo: Boolean(p.demo),
        price: price,
        priceInstallment: Math.max(0, parseInt(p.priceInstallment, 10) || Math.round(price / 24)),
        youtubeUrl: p.youtubeUrl || '',
        description: p.description || '',
        images: Array.isArray(p.images) ? p.images.filter(Boolean) : [],
        specs: (p.specs && typeof p.specs === 'object') ? p.specs : {}
      };
    });
  }

  function applyConfig() {
    var phone = CFG.phone || FALLBACK.phone;
    var tel = CFG.phoneTel || phone;
    all('[data-phone]').forEach(function (a) {
      a.textContent = phone;
      a.setAttribute('href', 'tel:' + String(tel).replace(/[^0-9+]/g, ''));
    });
    var ig = $('igLink');
    if (ig) {
      if (CFG.instagram) ig.setAttribute('href', CFG.instagram);
      else ig.remove();
    }
    if ($('kick')) $('kick').textContent = CFG.brandLine || FALLBACK.brandLine;
    if ($('hsub')) $('hsub').textContent = CFG.heroSub || FALLBACK.heroSub;
    if ($('manifestText')) {
      var text = CFG.manifest || FALLBACK.manifest;
      $('manifestText').innerHTML = esc(text).replace(/(сами [а-яё]+)/gi, '<b>$1</b>');
    }
    var h1 = $('heroTitle');
    if (h1) {
      var parts = String(CFG.heroTitle || FALLBACK.heroTitle).split('|');
      var markup = parts.map(function (line) {
        return '<i><span>' + esc(line).replace(/\.$/, '<em>.</em>') + '</span></i>';
      }).join('');
      /* перерисовываем только при настоящем изменении: иначе строка
         во второй раз уезжала бы вниз уже после загрузки данных */
      if (h1.innerHTML.replace(/\s+/g, '') !== markup.replace(/\s+/g, '')) {
        h1.innerHTML = markup;
      }
    }
  }

  /* ---------- герой: сетка из фирменных крестов ---------- */

  function heroField() {
    var cv = $('nodes');
    if (!cv || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    var ctx = cv.getContext('2d');
    var marks = [];
    var w = 0, h = 0, t = 0, raf = 0;

    function build() {
      var box = cv.getBoundingClientRect();
      var dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = box.width; h = box.height;
      cv.width = w * dpr; cv.height = h * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      marks = [];
      var step = w < 700 ? 56 : 74;
      for (var y = step / 2; y < h + step; y += step) {
        for (var x = step / 2; x < w + step; x += step) {
          marks.push({ x: x, y: y, p: Math.random() * Math.PI * 2, s: step * 0.17 });
        }
      }
    }

    function frame() {
      ctx.clearRect(0, 0, w, h);
      t += 0.0075;
      for (var i = 0; i < marks.length; i++) {
        var m = marks[i];
        var pulse = (Math.sin(t + m.p) + 1) / 2;
        var size = m.s * (0.55 + pulse * 0.45);
        ctx.save();
        ctx.translate(m.x, m.y);
        ctx.transform(1, 0, Math.tan(-10 * Math.PI / 180), 1, 0, 0);
        ctx.strokeStyle = pulse > 0.82
          ? 'rgba(30,94,224,' + (0.25 + pulse * 0.5).toFixed(3) + ')'
          : 'rgba(246,246,243,' + (0.05 + pulse * 0.10).toFixed(3) + ')';
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.moveTo(-size, -size); ctx.lineTo(size, size);
        ctx.moveTo(size, -size); ctx.lineTo(-size, size);
        ctx.stroke();
        ctx.restore();
      }
      raf = requestAnimationFrame(frame);
    }

    build();
    frame();
    var resizeTimer;
    window.addEventListener('resize', function () {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(build, 180);
    });
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) { cancelAnimationFrame(raf); raf = 0; }
      else if (!raf) frame();
    });
  }

  /* ---------- бегущая строка ---------- */

  function ticker() {
    var a = $('mqA'), b = $('mqB');
    if (!a) return;
    var bits = ['ГАРАНТИЯ ДО 12 МЕСЯЦЕВ', 'ДОСТАВКА ПО ВСЕМУ КАЗАХСТАНУ', 'РАССРОЧКА НА 24 МЕСЯЦА',
      'СОБСТВЕННЫЙ БРЕНД', 'ОБСЛУЖИВАЕМ САМИ'];
    var line = bits.join('  ✕  ') + '  ✕  ';
    a.textContent = line;
    if (b) b.textContent = line;
  }

  /* ---------- карточка-плитка ---------- */

  function tile(p) {
    var img = lead(p);
    var badges = '';
    if (p.isNew) badges += '<span class="badge new">Новинка</span>';
    if (p.hit) badges += '<span class="badge hit">Хит</span>';
    return '<article class="card" role="listitem" data-id="' + esc(p.id) + '" tabindex="0">' +
      '<div class="ph">' +
        (badges ? '<div class="badges">' + badges + '</div>' : '') +
        (img
          ? '<img src="' + esc(img) + '" alt="' + esc(p.name) + '" loading="lazy">'
          : '<div class="void">' + XMARK + '</div>') +
      '</div>' +
      '<div class="body">' +
        (p.sub ? '<div class="sub">' + esc(p.sub) + '</div>' : '') +
        '<h3>' + esc(p.name) + '</h3>' +
        '<div class="pr">' + fmt(p.price) + '</div>' +
        '<div class="ins">' + fmt(p.priceInstallment) + ' × 24 мес</div>' +
      '</div></article>';
  }

  function wireTiles(root) {
    all('.card', root).forEach(function (el) {
      el.addEventListener('click', function () { openProduct(el.getAttribute('data-id')); });
      el.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openProduct(el.getAttribute('data-id')); }
      });
    });
  }

  /* ---------- категории на главной ---------- */

  function buildCats() {
    var box = $('catWrap');
    if (!box) return;
    var html = CATS.map(function (c, i) {
      var n = P.filter(function (p) { return p.category === c.key; }).length;
      return '<a class="catCard" href="/catalogue/?c=' + c.key + '">' +
        '<span class="xm">' + XMARK + '</span>' +
        '<div class="n">' + String(i + 1).padStart(2, '0') + '</div>' +
        '<h3>' + esc(c.name) + '</h3>' +
        '<div class="eyebrow" style="text-transform:none;letter-spacing:0">' + esc(c.hint) + '</div>' +
        '<div class="c">' + (n ? n + ' ' + plural(n, 'товар', 'товара', 'товаров') : 'скоро') + '</div>' +
        '</a>';
    }).join('');
    box.innerHTML = html;
  }

  function plural(n, one, few, many) {
    var a = Math.abs(n) % 100, b = a % 10;
    if (a > 10 && a < 20) return many;
    if (b > 1 && b < 5) return few;
    if (b === 1) return one;
    return many;
  }

  /* ---------- акции ---------- */

  function buildPromos() {
    var sec = $('promos'), rail = $('promoRail');
    if (!sec || !rail) return;
    var items = (PROMOS || []).filter(function (x) { return x && x.image; });
    if (!items.length) { sec.hidden = true; return; }
    sec.hidden = false;
    rail.innerHTML = items.map(function (x) {
      var inner = '<img src="' + esc(x.image) + '" alt="' + esc(x.title || 'Акция') + '" loading="lazy">' +
        (x.title ? '<div class="cap">' + esc(x.title) + '</div>' : '');
      return x.link
        ? '<a href="' + esc(x.link) + '">' + inner + '</a>'
        : '<div class="pitem">' + inner + '</div>';
    }).join('');
    all('.promoNav button').forEach(function (b) {
      b.addEventListener('click', function () {
        var step = rail.firstElementChild ? rail.firstElementChild.offsetWidth + 18 : 300;
        rail.scrollBy({ left: step * Number(b.getAttribute('data-d')), behavior: 'smooth' });
      });
    });
  }

  /* ---------- сравнение моделей ----------
     Ползунок по бюджету дублировал каталог и ничего не решал. Настоящий
     вопрос покупателя другой: чем эта модель отличается от соседней.
     Берём две позиции одной категории и показываем характеристики рядом,
     подсвечивая строки, где значения расходятся. */

  function buildCompare() {
    var wrap = $('cmpWrap');
    if (!wrap) return;

    var cats = CATS.filter(function (c) {
      return P.filter(function (p) { return p.category === c.key; }).length >= 2;
    });
    if (!cats.length) {
      wrap.innerHTML = '<div class="empty"><b>Сравнивать пока нечего</b>' +
        'Нужно хотя бы два товара в одной категории.</div>';
      return;
    }

    var active = cats[0].key;
    var leftId = null;
    var rightId = null;

    function inCat() {
      return P.filter(function (p) { return p.category === active; });
    }

    function options(list, chosen, exclude) {
      return list.map(function (p) {
        return '<option value="' + esc(p.id) + '"' +
          (p.id === chosen ? ' selected' : '') +
          (p.id === exclude ? ' disabled' : '') + '>' + esc(p.name) + '</option>';
      }).join('');
    }

    function render() {
      var list = inCat();
      /* По умолчанию показываем две ближайшие по цене модели: у соседей
         расходится немного строк, и подсветка что-то значит. Первые две
         подряд могли оказаться креслом за 20 тысяч и за 350 — там
         подсвечивалось бы всё подряд. */
      if (!list.some(function (p) { return p.id === leftId; }) ||
          !list.some(function (p) { return p.id === rightId; }) || leftId === rightId) {
        var byPrice = list.slice().sort(function (a, b) { return a.price - b.price; });
        var bestGap = Infinity;
        var pair = [byPrice[0], byPrice[1] || byPrice[0]];
        for (var i = 1; i < byPrice.length; i++) {
          var gap = Math.abs(byPrice[i].price - byPrice[i - 1].price);
          if (gap < bestGap) { bestGap = gap; pair = [byPrice[i - 1], byPrice[i]]; }
        }
        leftId = pair[0].id;
        rightId = pair[1].id;
      }
      var a = list.filter(function (p) { return p.id === leftId; })[0];
      var b = list.filter(function (p) { return p.id === rightId; })[0];

      /* объединяем наборы характеристик, чтобы не потерять то,
         что есть только у одной модели */
      var keys = [];
      Object.keys(a.specs).forEach(function (k) { if (keys.indexOf(k) < 0) keys.push(k); });
      Object.keys(b.specs).forEach(function (k) { if (keys.indexOf(k) < 0) keys.push(k); });

      var rows = [
        { k: 'Цена', va: fmt(a.price), vb: fmt(b.price) },
        { k: 'В месяц', va: fmt(a.priceInstallment), vb: fmt(b.priceInstallment) },
      ].concat(keys.map(function (k) {
        return { k: k, va: a.specs[k] || '—', vb: b.specs[k] || '—' };
      }));

      wrap.innerHTML =
        '<div class="cmpChips">' + cats.map(function (c) {
          return '<button type="button" class="chip' + (c.key === active ? ' on' : '') +
            '" data-c="' + c.key + '">' + esc(c.name) + '</button>';
        }).join('') + '</div>' +
        '<div class="cmpGrid">' +
          '<div class="cmpCol">' +
            '<select class="cmpPick" data-side="left">' + options(list, leftId, rightId) + '</select>' +
            cmpHead(a) +
          '</div>' +
          '<div class="cmpCol">' +
            '<select class="cmpPick" data-side="right">' + options(list, rightId, leftId) + '</select>' +
            cmpHead(b) +
          '</div>' +
        '</div>' +
        '<div class="cmpTable">' + rows.map(function (r) {
          var differs = String(r.va).trim() !== String(r.vb).trim();
          return '<div class="cmpRow' + (differs ? ' differs' : '') + '">' +
            '<span class="cmpK">' + esc(r.k) + '</span>' +
            '<span class="cmpV">' + esc(r.va) + '</span>' +
            '<span class="cmpV">' + esc(r.vb) + '</span></div>';
        }).join('') + '</div>' +
        '<p class="cmpHint">Подсвечены строки, где модели расходятся.</p>';

      all('.cmpChips .chip', wrap).forEach(function (btn) {
        btn.addEventListener('click', function () {
          active = btn.getAttribute('data-c');
          leftId = null;
          rightId = null;
          render();
        });
      });
      all('.cmpPick', wrap).forEach(function (sel) {
        sel.addEventListener('change', function () {
          if (sel.getAttribute('data-side') === 'left') leftId = sel.value;
          else rightId = sel.value;
          render();
        });
      });
      all('.cmpCard', wrap).forEach(function (el) {
        el.addEventListener('click', function () { openProduct(el.getAttribute('data-id')); });
      });
    }

    function cmpHead(p) {
      var img = lead(p);
      return '<div class="cmpCard" data-id="' + esc(p.id) + '">' +
        (img ? '<img src="' + esc(img) + '" alt="' + esc(p.name) + '">'
             : '<div class="cmpVoid">' + XMARK + '</div>') +
        '<b>' + esc(p.name) + '</b>' +
        '<span>' + esc(p.sub || '') + '</span></div>';
    }

    render();
  }

  /* ---------- размер в масштабе ----------
     Для мебели главный вопрос — «а влезет?». Рисуем габариты товара рядом
     с фигурой ростом 170 см, в одном масштабе. Выносные линии здесь те же,
     что на фирменных карточках, так что блок читается как продолжение знака.

     Размеры в каталоге записаны шестью разными способами: «97 × 294 × 97 мм»,
     «35x14x4.5cm», «116*74*104», «163х50х53 см» — причём в последнем «х»
     кириллическая. Поэтому разбор терпимый к формату. */

  var HUMAN_CM = 170;

  function parseDims(p) {
    var specs = p.specs || {};
    var keys = Object.keys(specs);

    /* сначала ищем одну строку с тремя числами */
    var sizeKey = keys.filter(function (k) { return /размер|габарит/i.test(k); })[0];
    if (sizeKey) {
      var raw = String(specs[sizeKey]);
      var nums = raw.match(/\d+(?:[.,]\d+)?/g);
      if (nums && nums.length >= 3) {
        var vals = nums.slice(0, 3).map(function (n) { return parseFloat(n.replace(',', '.')); });
        /* миллиметры переводим в сантиметры */
        if (/мм|\bmm\b/i.test(raw)) vals = vals.map(function (v) { return v / 10; });
        /* порядок берём из подписи, если он там указан */
        /* Порядок чисел в строке нигде не стандартизован. Берём его из
           подписи вида «Размеры (ВxШxГ)». Если подписи нет — пробуем
           единственный надёжный признак: когда два значения совпадают,
           это основание, а третье и есть высота. Во всех остальных
           случаях честнее промолчать, чем положить товар набок. */
        var order = (sizeKey.match(/\(([ВШГДвшгд x×х*]+)\)/) || [])[1] || '';
        var letters = order.replace(/[^ВШГДвшгд]/g, '').toUpperCase().split('');
        if (letters.length === 3) {
          var out = {};
          letters.forEach(function (L, i) {
            if (L === 'В') out.h = vals[i];
            else if (L === 'Ш') out.w = vals[i];
            else out.d = vals[i];
          });
          if (out.h && out.w) return out;
          return null;
        }
        if (vals[0] === vals[1] && vals[1] !== vals[2]) return { h: vals[2], w: vals[0], d: vals[1] };
        if (vals[0] === vals[2] && vals[0] !== vals[1]) return { h: vals[1], w: vals[0], d: vals[2] };
        if (vals[1] === vals[2] && vals[0] !== vals[1]) return { h: vals[0], w: vals[1], d: vals[2] };
        return null;
      }
    }

    /* иначе собираем из отдельных полей */
    function pick(re) {
      var k = keys.filter(function (x) { return re.test(x); })[0];
      if (!k) return 0;
      var m = String(specs[k]).match(/\d+(?:[.,]\d+)?/);
      if (!m) return 0;
      var v = parseFloat(m[0].replace(',', '.'));
      if (/мм|\bmm\b/i.test(String(specs[k]))) v = v / 10;
      return v;
    }
    var h = pick(/^высота/i), w = pick(/^ширина/i), d = pick(/^(длина|глубина)/i);
    if (h && w) return { h: h, w: w, d: d };
    return null;
  }

  function buildScale() {
    var wrap = $('scaleWrap');
    if (!wrap) return;

    var items = P.map(function (p) { return { p: p, d: parseDims(p) }; })
      .filter(function (x) { return x.d && x.d.h > 5 && x.d.w > 5 && x.d.h < 400; });

    if (!items.length) {
      wrap.innerHTML = '<div class="empty"><b>Размеры пока не заполнены</b>' +
        'Блок появится, когда у товаров будут габариты.</div>';
      return;
    }

    var idx = 0;

    function draw() {
      var it = items[idx];
      var d = it.d;
      /* Рисуем самую длинную горизонталь: кушетку длиной 180 см странно
         показывать с торца, шириной 70. В подписи честно говорим,
         какой это размер. */
      var span = Math.max(d.w, d.d || 0);
      var spanLabel = (d.d && d.d > d.w) ? 'Длина' : 'Ширина';
      var tallest = Math.max(HUMAN_CM, d.h);
      var padTop = 28;
      var boxH = 300;
      var scale = (boxH - padTop) / tallest;

      var manH = Math.round(HUMAN_CM * scale);
      var objH = Math.round(d.h * scale);
      var objW = Math.round(span * scale);
      var baseY = boxH - 10;

      wrap.innerHTML =
        '<div class="scalePick">' + items.map(function (x, i) {
          return '<button type="button" class="chip' + (i === idx ? ' on' : '') +
            '" data-i="' + i + '">' + esc(x.p.name) + '</button>';
        }).join('') + '</div>' +
        '<div class="scaleStage">' +
          '<svg viewBox="0 0 520 ' + boxH + '" role="img" aria-label="Размер ' +
              esc(it.p.name) + ' рядом с человеком ростом 170 см">' +
            '<line x1="0" y1="' + baseY + '" x2="520" y2="' + baseY + '" class="scaleFloor"/>' +
            manSvg(150, baseY, manH) +
            '<rect x="250" y="' + (baseY - objH) + '" width="' + objW + '" height="' + objH + '" class="scaleBox"/>' +
            /* высота */
            '<line x1="' + (250 + objW + 26) + '" y1="' + (baseY - objH) + '" x2="' + (250 + objW + 26) + '" y2="' + baseY + '" class="scaleDim"/>' +
            '<text x="' + (250 + objW + 36) + '" y="' + (baseY - objH / 2) + '" class="scaleLab" dominant-baseline="middle">' + d.h + ' см</text>' +
            /* ширина */
            '<line x1="250" y1="' + (baseY + 16) + '" x2="' + (250 + objW) + '" y2="' + (baseY + 16) + '" class="scaleDim"/>' +
            '<text x="' + (250 + objW / 2) + '" y="' + (baseY + 34) + '" class="scaleLab" text-anchor="middle">' + span + ' см</text>' +
            '<text x="150" y="' + (baseY - manH - 10) + '" class="scaleLab" text-anchor="middle">170 см</text>' +
          '</svg>' +
        '</div>' +
        '<div class="scaleMeta">' +
          '<div><b>' + esc(it.p.name) + '</b><span>' + esc(it.p.sub || '') + '</span></div>' +
          '<div class="scaleNums">' +
            '<span>Высота <b>' + d.h + ' см</b></span>' +
            '<span>Ширина <b>' + d.w + ' см</b></span>' +
            (d.d ? '<span>Глубина <b>' + d.d + ' см</b></span>' : '') +
            '<span>На рисунке <b>' + spanLabel.toLowerCase() + '</b></span>' +
          '</div>' +
        '</div>';

      all('.scalePick .chip', wrap).forEach(function (b) {
        b.addEventListener('click', function () { idx = Number(b.getAttribute('data-i')); draw(); });
      });
    }

    /* простая фигура: голова, корпус, руки, ноги — ровно по росту */
    function manSvg(cx, baseY, h) {
      var head = h * 0.13;
      var topY = baseY - h;
      var neckY = topY + head * 2;
      var hipY = baseY - h * 0.47;
      return '<g class="scaleMan">' +
        '<circle cx="' + cx + '" cy="' + (topY + head) + '" r="' + head + '"/>' +
        '<line x1="' + cx + '" y1="' + neckY + '" x2="' + cx + '" y2="' + hipY + '"/>' +
        '<line x1="' + (cx - head * 1.3) + '" y1="' + (neckY + head * 0.6) + '" x2="' + cx + '" y2="' + (neckY + head * 0.2) + '"/>' +
        '<line x1="' + (cx + head * 1.3) + '" y1="' + (neckY + head * 0.6) + '" x2="' + cx + '" y2="' + (neckY + head * 0.2) + '"/>' +
        '<line x1="' + cx + '" y1="' + hipY + '" x2="' + (cx - head * 0.9) + '" y2="' + baseY + '"/>' +
        '<line x1="' + cx + '" y1="' + hipY + '" x2="' + (cx + head * 0.9) + '" y2="' + baseY + '"/>' +
        '</g>';
    }

    draw();
  }

  /* ---------- страница каталога ---------- */

  function buildCatalogue() {
    var grid = $('grid'), chips = $('chips'), q = $('q');
    if (!grid || !chips) return;
    var params = new URLSearchParams(location.search);
    var active = params.get('c') || 'all';
    var term = '';

    var list = [{ key: 'all', name: 'Все' }].concat(CATS.filter(function (c) {
      return P.some(function (p) { return p.category === c.key; });
    }));

    chips.innerHTML = list.map(function (c) {
      return '<button type="button" class="chip' + (c.key === active ? ' on' : '') +
        '" data-c="' + c.key + '">' + esc(c.name) + '</button>';
    }).join('');

    all('.chip', chips).forEach(function (b) {
      b.addEventListener('click', function () {
        active = b.getAttribute('data-c');
        all('.chip', chips).forEach(function (x) { x.classList.toggle('on', x === b); });
        var url = active === 'all' ? location.pathname : location.pathname + '?c=' + active;
        history.replaceState(null, '', url);
        render();
      });
    });

    if (q) {
      q.addEventListener('input', function () { term = q.value.trim().toLowerCase(); render(); });
    }

    function render() {
      var rows = P.filter(function (p) {
        if (active !== 'all' && p.category !== active) return false;
        if (!term) return true;
        return (p.name + ' ' + p.sub + ' ' + p.description).toLowerCase().indexOf(term) >= 0;
      });
      grid.innerHTML = rows.length
        ? rows.map(tile).join('')
        : '<div class="empty"><b>Ничего не нашлось</b>' +
          (P.length ? 'Попробуйте другой запрос или категорию.' : 'Каталог ещё наполняется — загляните чуть позже.') +
          '</div>';
      wireTiles(grid);
      if ($('count')) {
        $('count').textContent = rows.length + ' ' + plural(rows.length, 'товар', 'товара', 'товаров');
      }
    }

    render();
  }

  /* ---------- карточка товара ---------- */

  var SHEET_OPEN = null;

  function openProduct(id) {
    var p = P.filter(function (x) { return x.id === id; })[0];
    if (!p) return;
    SHEET_OPEN = p;
    fillSheet(p);
    $('dim').classList.add('on');
    $('sheet').classList.add('on');
    $('closeSheet').classList.add('on');
    document.body.classList.add('locked');
  }

  function closeProduct() {
    SHEET_OPEN = null;
    $('dim').classList.remove('on');
    $('sheet').classList.remove('on');
    $('closeSheet').classList.remove('on');
    document.body.classList.remove('locked');
  }

  function fillSheet(p) {
    var imgs = p.images.length ? p.images : [];
    var gallery = imgs.length
      ? '<div class="main"><img id="shMain" src="' + esc(imgs[0]) + '" alt="' + esc(p.name) + '"></div>' +
        (imgs.length > 1
          ? '<div class="thumbs">' + imgs.map(function (src, i) {
              return '<button type="button" class="' + (i ? '' : 'on') + '" data-i="' + i + '">' +
                '<img src="' + esc(src) + '" alt=""></button>';
            }).join('') + '</div>'
          : '')
      : '<div class="main"><div class="void" style="display:grid;place-items:center;height:100%;opacity:.15">' +
        XMARK + '</div></div>';

    var specRows = Object.keys(p.specs).map(function (k) {
      return '<div><span>' + esc(k) + '</span><span>' + esc(p.specs[k]) + '</span></div>';
    }).join('');

    $('sheet').innerHTML =
      '<div class="sh">' +
        '<div class="shGal">' + gallery + '</div>' +
        '<div class="shInfo">' +
          (p.sub ? '<div class="sub">' + esc(p.sub) + ' · ' + esc(catName(p.category)) + '</div>' : '') +
          '<h2>' + esc(p.name) + '</h2>' +
          '<div class="shPrice"><b>' + fmt(p.price) + '</b>' +
            '<span>примерно ' + fmt(p.priceInstallment) + ' в месяц при рассрочке на 24 месяца</span></div>' +
          (p.description ? '<p class="desc">' + esc(p.description) + '</p>' : '') +
          '<div class="shActions">' +
            '<button type="button" class="btn btn-a" id="shAdd">В корзину</button>' +
            (p.youtubeUrl ? '<a class="btn btn-b" href="' + esc(p.youtubeUrl) +
              '" target="_blank" rel="noopener">Видео</a>' : '') +
          '</div>' +
          (specRows ? '<div class="specs">' + specRows + '</div>' : '') +
          (p.warranty ? '<div class="shMeta">Гарантия ' + esc(p.warranty) +
            ' · доставка по Казахстану</div>' : '') +
        '</div>' +
      '</div>';

    $('shAdd').addEventListener('click', function () { cartAdd(p.id, 1); });

    all('.shGal .thumbs button').forEach(function (b) {
      b.addEventListener('click', function () {
        $('shMain').src = imgs[Number(b.getAttribute('data-i'))];
        all('.shGal .thumbs button').forEach(function (x) { x.classList.toggle('on', x === b); });
      });
    });
  }

  /* ---------- корзина ----------
     Состояние — {id: количество} в localStorage, всё остальное считается
     из него, поэтому после перезагрузки корзина та же. submitOrder() —
     единственное место, которое знает, куда уходит заказ: сегодня в
     WhatsApp, завтра можно заменить на собственный приём заказов. */

  var CART_KEY = 'dorx_cart_v1', CART = {};
  var PROMO_KEY = 'dorx_promo_v1', PROMO = null;

  function cartLoad() {
    try { CART = JSON.parse(localStorage.getItem(CART_KEY) || '{}') || {}; } catch (e) { CART = {}; }
    try { PROMO = JSON.parse(localStorage.getItem(PROMO_KEY) || 'null'); } catch (e) { PROMO = null; }
  }

  function cartSave() {
    try {
      localStorage.setItem(CART_KEY, JSON.stringify(CART));
      if (PROMO) localStorage.setItem(PROMO_KEY, JSON.stringify(PROMO));
      else localStorage.removeItem(PROMO_KEY);
    } catch (e) { /* приватный режим — просто живём без памяти */ }
  }

  /* товар, ушедший из каталога, не должен висеть в корзине */
  function cartLines() {
    return Object.keys(CART).map(function (id) {
      var p = P.filter(function (x) { return x.id === id; })[0];
      return p ? { p: p, q: Math.max(1, Math.min(99, CART[id] | 0)) } : null;
    }).filter(Boolean);
  }

  function cartSums() {
    var lines = cartLines();
    var sub = lines.reduce(function (n, l) { return n + l.p.price * l.q; }, 0);
    var disc = 0;
    if (PROMO && PROMO.percent) disc = Math.round(sub * PROMO.percent / 100);
    if (PROMO && PROMO.amount) disc = Math.min(sub, PROMO.amount);
    return { lines: lines, sub: sub, disc: disc, total: Math.max(0, sub - disc) };
  }

  function cartSet(id, q) {
    q = q | 0;
    if (q <= 0) delete CART[id]; else CART[id] = Math.min(99, q);
    cartSave();
    cartPaint();
  }

  function cartAdd(id, q) {
    cartSet(id, (CART[id] | 0) + (q || 1));
    var p = P.filter(function (x) { return x.id === id; })[0];
    toast((p ? p.name : 'Товар') + ' — в корзине');
  }

  function promoFind(code) {
    code = String(code || '').trim().toUpperCase();
    if (!code) return null;
    var hit = (PROMOS || []).filter(function (x) {
      return String((x && x.code) || '').trim().toUpperCase() === code;
    })[0];
    if (!hit) return null;
    if (hit.until && new Date(hit.until) < new Date()) return null;
    if (hit.active === false) return null;
    var pct = parseFloat(hit.percent || 0) || 0;
    var amt = parseFloat(hit.amount || 0) || 0;
    if (!pct && !amt) return null;
    return { code: code, percent: pct, amount: amt };
  }

  function orderText() {
    var s = cartSums();
    var rows = s.lines.map(function (l, i) {
      return (i + 1) + ') ' + l.p.name + ' × ' + l.q + ' — ' + fmt(l.p.price * l.q);
    }).join('\n');
    return 'Здравствуйте! Хочу оформить заказ на DORX:\n\n' + rows +
      '\n\nСумма: ' + fmt(s.sub) +
      (s.disc ? '\nСкидка (' + PROMO.code + '): -' + fmt(s.disc) : '') +
      '\nИтого: ' + fmt(s.total);
  }

  function submitOrder() {
    var phone = String(CFG.whatsapp || CFG.phoneTel || CFG.phone || FALLBACK.phoneTel).replace(/[^0-9]/g, '');
    window.open('https://wa.me/' + phone + '?text=' + encodeURIComponent(orderText()), '_blank', 'noopener');
  }

  function buildCart() {
    var nav = document.querySelector('header .bar nav');
    if (nav && !$('cartBtn')) {
      var b = document.createElement('button');
      b.id = 'cartBtn';
      b.type = 'button';
      b.className = 'keep';
      b.setAttribute('aria-label', 'Корзина');
      b.innerHTML = 'Корзина <span id="cartN">0</span>';
      b.addEventListener('click', function () { cartOpen(true); });
      nav.appendChild(b);
    }

    var d = document.createElement('div');
    d.id = 'cartDrawer';
    d.innerHTML =
      '<div class="cartScrim"></div>' +
      '<aside class="cartPanel" role="dialog" aria-modal="true" aria-label="Корзина">' +
        '<div class="cartHead"><b>Корзина</b>' +
          '<button type="button" class="cartClose" aria-label="Закрыть">&times;</button></div>' +
        '<div class="cartBody" id="cartBody"></div>' +
        '<div class="cartFoot" id="cartFoot" hidden>' +
          '<div class="promoBox"><input id="promoIn" type="text" placeholder="Промокод" ' +
            'autocomplete="off" spellcheck="false">' +
            '<button type="button" id="promoGo">Применить</button></div>' +
          '<div class="promoTag" id="promoTag" hidden><span></span>' +
            '<button type="button" id="promoDel" aria-label="Убрать промокод">&times;</button></div>' +
          '<div class="cartLine"><span>Сумма</span><b id="cartSub">0</b></div>' +
          '<div class="cartLine" id="cartDiscRow" hidden><span>Скидка</span><b id="cartDisc">0</b></div>' +
          '<div class="cartLine tot"><span>Итого</span><b id="cartTotal">0</b></div>' +
          '<div class="cartInst" id="cartInst"></div>' +
          '<button type="button" class="btn btn-a" id="cartGo">Оформить заказ</button>' +
          '<button type="button" class="cartClear" id="cartClear">Очистить корзину</button>' +
        '</div>' +
      '</aside>';
    document.body.appendChild(d);

    d.querySelector('.cartScrim').addEventListener('click', function () { cartOpen(false); });
    d.querySelector('.cartClose').addEventListener('click', function () { cartOpen(false); });
    $('cartGo').addEventListener('click', submitOrder);
    $('cartClear').addEventListener('click', function () {
      CART = {}; PROMO = null; cartSave(); cartPaint();
    });
    $('promoGo').addEventListener('click', function () {
      var found = promoFind($('promoIn').value);
      if (!found) { toast('Такой промокод не действует'); return; }
      PROMO = found;
      $('promoIn').value = '';
      cartSave();
      cartPaint();
    });
    $('promoDel').addEventListener('click', function () { PROMO = null; cartSave(); cartPaint(); });

    cartLoad();
    cartPaint();
  }

  function cartOpen(on) {
    var d = $('cartDrawer');
    if (!d) return;
    d.classList.toggle('on', Boolean(on));
    document.body.classList.toggle('locked', Boolean(on));
  }

  function cartPaint() {
    var s = cartSums();
    var count = s.lines.reduce(function (n, l) { return n + l.q; }, 0);
    if ($('cartN')) $('cartN').textContent = count;

    var body = $('cartBody');
    if (!body) return;

    if (!s.lines.length) {
      body.innerHTML = '<div class="cartEmpty">' + XMARK +
        '<div>Пока пусто.<br>Загляните в каталог.</div></div>';
      $('cartFoot').hidden = true;
      return;
    }

    $('cartFoot').hidden = false;
    body.innerHTML = s.lines.map(function (l) {
      var img = lead(l.p);
      return '<div class="cartRow" data-id="' + esc(l.p.id) + '">' +
        (img ? '<img src="' + esc(img) + '" alt="">' : '<div style="width:64px;height:64px"></div>') +
        '<div><div class="nm">' + esc(l.p.name) + '</div>' +
          '<div class="pr">' + fmt(l.p.price * l.q) + '</div></div>' +
        '<div class="qty"><button type="button" data-d="-1" aria-label="Меньше">&minus;</button>' +
          '<b>' + l.q + '</b>' +
          '<button type="button" data-d="1" aria-label="Больше">+</button></div>' +
        '</div>';
    }).join('');

    all('.cartRow .qty button', body).forEach(function (b) {
      b.addEventListener('click', function () {
        var row = b.closest('.cartRow');
        var id = row.getAttribute('data-id');
        cartSet(id, (CART[id] | 0) + Number(b.getAttribute('data-d')));
      });
    });

    $('cartSub').textContent = fmt(s.sub);
    $('cartTotal').textContent = fmt(s.total);
    $('cartDiscRow').hidden = !s.disc;
    if (s.disc) $('cartDisc').textContent = '-' + fmt(s.disc);
    $('promoTag').hidden = !PROMO;
    if (PROMO) {
      $('promoTag').querySelector('span').textContent = 'Промокод ' + PROMO.code + ' применён';
    }
    $('cartInst').textContent = 'Примерно ' + fmt(Math.round(s.total / 24)) + ' в месяц при рассрочке на 24 месяца';
  }

  var toastTimer;
  function toast(text) {
    var t = $('toast');
    if (!t) {
      t = document.createElement('div');
      t.id = 'toast';
      document.body.appendChild(t);
    }
    t.textContent = text;
    t.classList.add('on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove('on'); }, 2600);
  }

  /* ---------- появление и счётчики ---------- */

  function initReveal() {
    var nodes = all('.rv');
    if (!('IntersectionObserver' in window)) {
      nodes.forEach(function (n) { n.classList.add('on'); });
      return;
    }
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) { e.target.classList.add('on'); io.unobserve(e.target); }
      });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });
    nodes.forEach(function (n) { io.observe(n); });
  }

  function initCounters() {
    var nums = all('.nums .v');
    if (!nums.length || !('IntersectionObserver' in window)) {
      nums.forEach(function (n) { n.textContent = n.getAttribute('data-to') || n.textContent; });
      return;
    }
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (!e.isIntersecting) return;
        io.unobserve(e.target);
        run(e.target);
      });
    }, { threshold: 0.4 });
    nums.forEach(function (n) { io.observe(n); });

    function run(el) {
      var to = parseFloat(el.getAttribute('data-to')) || 0;
      var dec = parseInt(el.getAttribute('data-dec'), 10) || 0;
      var suf = el.getAttribute('data-suf') || '';
      var start = performance.now(), dur = 1300;
      (function step(now) {
        var k = Math.min(1, (now - start) / dur);
        var eased = 1 - Math.pow(1 - k, 3);
        var val = to * eased;
        el.textContent = (dec ? (val / Math.pow(10, dec)).toFixed(dec) : Math.round(val)) + suf;
        if (k < 1) requestAnimationFrame(step);
      })(start);
    }
  }

  /* ---------- запуск ---------- */

  function boot() {
    if ($('yr')) $('yr').textContent = new Date().getFullYear();

    $('dim').addEventListener('click', closeProduct);
    $('closeSheet').addEventListener('click', closeProduct);
    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape') return;
      if (SHEET_OPEN) closeProduct();
      else cartOpen(false);
    });

    heroField();
    ticker();
    initReveal();

    Promise.all([
      j('/products.json').catch(function () { return []; }),
      j('/site-config.json').catch(function () { return {}; }),
      j('/promos.json').catch(function () { return []; })
    ]).then(function (res) {
      P = normalise(res[0]);
      CFG = res[1] && typeof res[1] === 'object' ? res[1] : {};
      PROMOS = Array.isArray(res[2]) ? res[2] : [];

      /* счётчик позиций знает настоящее число только после загрузки */
      var n = $('countProducts');
      if (n) n.setAttribute('data-to', String(P.length));

      applyConfig();
      buildCats();
      buildPromos();
      buildCompare();
      buildScale();
      buildCatalogue();
      buildCart();
      initCounters();
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
