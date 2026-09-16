#!/usr/bin/env node
'use strict';
/*
 * Управление каталогом DORX из любого чата — без браузера и админки.
 *
 * Сервер разговаривает с сайтом тем же API, что и панель управления:
 * логинится паролем, держит куку и правит те же самые файлы. Значит,
 * всё сделанное отсюда сразу видно на сайте, а панель и этот сервер
 * никогда не разъедутся.
 *
 * Настраивается двумя переменными:
 *   DORX_SITE_URL        адрес сайта (по умолчанию боевой)
 *   DORX_ADMIN_PASSWORD  пароль от панели
 */
const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const { z } = require('zod');
const fs = require('fs');
const path = require('path');

const SITE = (process.env.DORX_SITE_URL || 'https://dorx.kz').replace(/\/+$/, '');

/* Пароль берём из переменной окружения, а если её нет — из файла рядом.
   Файл в .gitignore: так пароль не попадёт ни в репозиторий, ни в настройки,
   и его не придётся держать в переменных среды. */
function readPassword() {
  if (process.env.DORX_ADMIN_PASSWORD) return process.env.DORX_ADMIN_PASSWORD.trim();
  const file = path.join(__dirname, 'password.txt');
  try {
    return fs.readFileSync(file, 'utf8').trim();
  } catch (e) {
    return '';
  }
}

const PASSWORD = readPassword();

const CATEGORIES = ['seating', 'mirrors', 'workspace', 'appliances', 'bath', 'home'];
const CATEGORY_RU = {
  seating: 'Кресла и мебель',
  mirrors: 'Зеркала',
  workspace: 'Рабочее место',
  appliances: 'Техника',
  bath: 'Ванная',
  home: 'Для дома',
};

/* ---------- разговор с сайтом ---------- */

let cookie = null;

async function login() {
  if (!PASSWORD) {
    throw new Error('Пароль не найден. Положите его в mcp/password.txt '
      + 'или задайте переменную DORX_ADMIN_PASSWORD.');
  }
  const r = await fetch(SITE + '/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: PASSWORD }),
  });
  if (!r.ok) {
    const body = await r.json().catch(() => ({}));
    throw new Error('Вход в панель не удался: ' + (body.error || r.status));
  }
  cookie = (r.headers.get('set-cookie') || '').split(';')[0];
  if (!cookie) throw new Error('Сайт не выдал сессию.');
}

/* Кука живёт 12 часов. Если истекла — логинимся заново и повторяем один раз. */
async function call(pathname, options, retrying) {
  if (!cookie) await login();
  const opts = Object.assign({}, options);
  opts.headers = Object.assign({}, options && options.headers, { Cookie: cookie });
  const r = await fetch(SITE + pathname, opts);
  if (r.status === 401 && !retrying) {
    cookie = null;
    return call(pathname, options, true);
  }
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(body.error || ('Сайт ответил ' + r.status));
  return body;
}

async function readProducts() {
  const r = await fetch(SITE + '/products.json', { cache: 'no-store' });
  if (!r.ok) throw new Error('Не удалось прочитать каталог: ' + r.status);
  return r.json();
}

async function writeProducts(list) {
  return call('/api/save', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(list),
  });
}

function slug(name) {
  const map = { а:'a',б:'b',в:'v',г:'g',д:'d',е:'e',ё:'e',ж:'zh',з:'z',и:'i',й:'y',к:'k',
    л:'l',м:'m',н:'n',о:'o',п:'p',р:'r',с:'s',т:'t',у:'u',ф:'f',х:'h',ц:'c',ч:'ch',
    ш:'sh',щ:'sch',ы:'y',э:'e',ю:'yu',я:'ya',ъ:'',ь:'' };
  return String(name).toLowerCase().split('')
    .map((c) => (map[c] !== undefined ? map[c] : c)).join('')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

function text(s) {
  return { content: [{ type: 'text', text: s }] };
}

function describe(p) {
  return [
    p.id,
    p.name,
    CATEGORY_RU[p.category] || p.category,
    (p.price || 0).toLocaleString('ru-RU') + ' ₸',
    (p.images || []).length + ' фото',
    Object.keys(p.specs || {}).length + ' характеристик',
  ].join(' | ');
}

/* ---------- инструменты ---------- */

const server = new McpServer({ name: 'dorx-site', version: '1.0.0' });

server.registerTool('list_products', {
  title: 'Список товаров',
  description: 'Показывает каталог сайта DORX: код, название, категорию, цену, сколько фотографий и характеристик. Можно сузить по категории или куску названия.',
  inputSchema: {
    category: z.enum(CATEGORIES).optional().describe('Показать только эту категорию'),
    search: z.string().optional().describe('Кусок названия для поиска'),
  },
}, async ({ category, search }) => {
  let list = await readProducts();
  if (category) list = list.filter((p) => p.category === category);
  if (search) {
    const q = search.toLowerCase();
    list = list.filter((p) => (p.name + ' ' + (p.sub || '')).toLowerCase().includes(q));
  }
  if (!list.length) return text('Ничего не нашлось.');
  const counts = {};
  list.forEach((p) => { counts[p.category] = (counts[p.category] || 0) + 1; });
  const head = 'Товаров: ' + list.length + '\n'
    + Object.entries(counts).map(([k, v]) => '  ' + (CATEGORY_RU[k] || k) + ': ' + v).join('\n');
  return text(head + '\n\n' + list.map(describe).join('\n'));
});

server.registerTool('get_product', {
  title: 'Карточка товара',
  description: 'Полное содержимое одной карточки: описание, характеристики, фотографии, цена.',
  inputSchema: { id: z.string().describe('Код товара из списка') },
}, async ({ id }) => {
  const list = await readProducts();
  const p = list.find((x) => x.id === id);
  if (!p) return text('Товара с кодом «' + id + '» нет. Посмотрите list_products.');
  return text(JSON.stringify(p, null, 2));
});

server.registerTool('add_product', {
  title: 'Добавить товар',
  description: 'Создаёт новый товар и сразу публикует его на сайте. Код придумывается из названия. Платёж в месяц считается сам, если не задан.',
  inputSchema: {
    name: z.string().describe('Название, например «DORX Aria»'),
    category: z.enum(CATEGORIES).describe('Категория каталога'),
    price: z.number().int().nonnegative().describe('Цена в тенге'),
    sub: z.string().optional().describe('Подзаголовок — тип товара, например «Офисное кресло»'),
    description: z.string().optional(),
    warranty: z.string().optional().describe('Например «12 месяцев»'),
    specs: z.record(z.string()).optional().describe('Характеристики парами свойство → значение'),
    images: z.array(z.string()).optional().describe('Адреса картинок; первая станет главной'),
    priceInstallment: z.number().int().nonnegative().optional(),
    hit: z.boolean().optional(),
    isNew: z.boolean().optional(),
    youtubeUrl: z.string().optional(),
  },
}, async (args) => {
  const list = await readProducts();
  let id = slug(args.name);
  let n = 2;
  while (list.some((p) => p.id === id)) { id = slug(args.name) + '-' + n; n += 1; }

  const item = {
    id,
    name: args.name,
    sub: args.sub || '',
    category: args.category,
    warranty: args.warranty || '12 месяцев',
    hit: Boolean(args.hit),
    isNew: Boolean(args.isNew),
    price: args.price,
    priceInstallment: args.priceInstallment || Math.round(args.price / 24),
    youtubeUrl: args.youtubeUrl || '',
    description: args.description || '',
    images: args.images || [],
    specs: args.specs || {},
  };
  list.push(item);
  await writeProducts(list);
  return text('Добавлено: ' + describe(item) + '\nВсего в каталоге: ' + list.length);
});

server.registerTool('update_product', {
  title: 'Изменить товар',
  description: 'Меняет поля существующего товара. Передавайте только то, что нужно поменять — остальное останется как было. Если меняете цену и не задаёте платёж, он пересчитается сам.',
  inputSchema: {
    id: z.string().describe('Код товара'),
    name: z.string().optional(),
    sub: z.string().optional(),
    category: z.enum(CATEGORIES).optional(),
    price: z.number().int().nonnegative().optional(),
    priceInstallment: z.number().int().nonnegative().optional(),
    description: z.string().optional(),
    warranty: z.string().optional(),
    specs: z.record(z.string()).optional().describe('Заменяет набор характеристик целиком'),
    images: z.array(z.string()).optional().describe('Заменяет список картинок целиком'),
    hit: z.boolean().optional(),
    isNew: z.boolean().optional(),
    youtubeUrl: z.string().optional(),
  },
}, async ({ id, ...patch }) => {
  const list = await readProducts();
  const i = list.findIndex((p) => p.id === id);
  if (i < 0) return text('Товара с кодом «' + id + '» нет.');

  const before = list[i];
  const changed = [];
  Object.keys(patch).forEach((k) => {
    if (patch[k] === undefined) return;
    if (JSON.stringify(before[k]) !== JSON.stringify(patch[k])) changed.push(k);
    before[k] = patch[k];
  });
  /* цена поменялась, а платёж задан не был — пересчитываем, иначе на карточке
     повиснет сумма от старой цены */
  if (patch.price !== undefined && patch.priceInstallment === undefined) {
    before.priceInstallment = Math.round(patch.price / 24);
    changed.push('priceInstallment (пересчитан)');
  }
  if (!changed.length) return text('Нечего менять — всё совпадает.');

  await writeProducts(list);
  return text('Изменено у «' + before.name + '»: ' + changed.join(', '));
});

server.registerTool('delete_product', {
  title: 'Удалить товар',
  description: 'Убирает товар с сайта. Действие необратимо, поэтому код нужно указать точно.',
  inputSchema: { id: z.string().describe('Код товара') },
}, async ({ id }) => {
  const list = await readProducts();
  const p = list.find((x) => x.id === id);
  if (!p) return text('Товара с кодом «' + id + '» нет.');
  const kept = list.filter((x) => x.id !== id);
  await writeProducts(kept);
  return text('Удалён «' + p.name + '». Осталось: ' + kept.length);
});

server.registerTool('upload_image', {
  title: 'Загрузить фотографию',
  description: 'Заливает картинку с диска на сайт и, если указан товар, добавляет её в его галерею. Годятся JPEG, PNG и WebP до 8 МБ.',
  inputSchema: {
    file_path: z.string().describe('Путь к файлу на этом компьютере'),
    product_id: z.string().optional().describe('Код товара, которому добавить фото'),
    make_lead: z.boolean().optional().describe('Поставить это фото главным'),
  },
}, async ({ file_path, product_id, make_lead }) => {
  if (!fs.existsSync(file_path)) return text('Файла нет: ' + file_path);
  const buf = fs.readFileSync(file_path);
  const ext = path.extname(file_path).toLowerCase();
  const type = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';

  const form = new FormData();
  form.append('files', new Blob([buf], { type }), path.basename(file_path));
  const up = await call('/api/upload', { method: 'POST', body: form });
  if (!up.ok) return text('Загрузить не удалось: ' + (up.error || 'неизвестная ошибка'));

  if (!product_id) return text('Загружено: ' + up.url);

  const list = await readProducts();
  const p = list.find((x) => x.id === product_id);
  if (!p) return text('Картинка загружена (' + up.url + '), но товара «' + product_id + '» нет.');
  p.images = p.images || [];
  if (make_lead) p.images.unshift(up.url);
  else p.images.push(up.url);
  await writeProducts(list);
  return text('Загружено и добавлено к «' + p.name + '»: ' + up.url
    + (make_lead ? ' (главное фото)' : '') + '. Всего фото: ' + p.images.length);
});

server.registerTool('get_settings', {
  title: 'Настройки сайта',
  description: 'Показывает контакты и тексты главной страницы.',
  inputSchema: {},
}, async () => {
  const r = await fetch(SITE + '/site-config.json', { cache: 'no-store' });
  return text(JSON.stringify(await r.json(), null, 2));
});

server.registerTool('update_settings', {
  title: 'Изменить настройки',
  description: 'Меняет контакты и тексты главной. Передавайте только то, что нужно поменять.',
  inputSchema: {
    phone: z.string().optional().describe('Телефон для показа'),
    phoneTel: z.string().optional().describe('Телефон для набора, только цифры и плюс'),
    whatsapp: z.string().optional().describe('Номер для заказов из корзины'),
    instagram: z.string().optional(),
    brandLine: z.string().optional().describe('Строка над заголовком героя'),
    heroTitle: z.string().optional().describe('Заголовок героя; вертикальная черта делит на строки'),
    heroSub: z.string().optional(),
    manifest: z.string().optional().describe('Фраза-манифест'),
  },
}, async (patch) => {
  const clean = {};
  Object.keys(patch).forEach((k) => { if (patch[k] !== undefined) clean[k] = patch[k]; });
  if (!Object.keys(clean).length) return text('Нечего менять.');
  const r = await call('/api/save-config', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(clean),
  });
  return text('Настройки обновлены: ' + Object.keys(clean).join(', ')
    + '\n\n' + JSON.stringify(r.config, null, 2));
});

server.registerTool('site_status', {
  title: 'Что сейчас на сайте',
  description: 'Короткая сводка: жив ли сайт, сколько товаров, у скольких есть фотографии и характеристики.',
  inputSchema: {},
}, async () => {
  const health = await fetch(SITE + '/healthz').then((r) => r.ok).catch(() => false);
  if (!health) return text('Сайт ' + SITE + ' не отвечает.');
  const list = await readProducts();
  const promos = await fetch(SITE + '/promos.json').then((r) => r.json()).catch(() => []);
  const withImg = list.filter((p) => (p.images || []).length).length;
  const withSpec = list.filter((p) => Object.keys(p.specs || {}).length).length;
  return text([
    'Сайт: ' + SITE + ' — отвечает',
    'Товаров: ' + list.length,
    'С фотографиями: ' + withImg + ' (без фото: ' + (list.length - withImg) + ')',
    'С характеристиками: ' + withSpec,
    'Баннеров акций: ' + (Array.isArray(promos) ? promos.length : 0),
  ].join('\n'));
});

async function main() {
  await server.connect(new StdioServerTransport());
}

main().catch((e) => {
  process.stderr.write('dorx-site MCP не запустился: ' + e.message + '\n');
  process.exit(1);
});
