'use strict';
/*
 * DORX — сайт бренда.
 *
 * Отдаёт статический каталог из /public и небольшой API для админки.
 * Данные (товары, акции, настройки, картинки) лежат в DATA_DIR — на Railway
 * это примонтированный диск, поэтому загруженные фотографии переживают
 * перевыкладку. При первом запуске папка наполняется из /seed.
 */
const express = require('express');
const cookieParser = require('cookie-parser');
const multer = require('multer');
const crypto = require('crypto');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PUBLIC_DIR = path.join(ROOT, 'public');
const SEED_DIR = path.join(ROOT, 'seed');
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(ROOT, 'data'));
const IMG_DIR = path.join(DATA_DIR, 'images');
const PORT = Number(process.env.PORT || 3000);

/* Ни пароля, ни ключа сессий по умолчанию нет. Код открыт, поэтому любое
 * значение из него — или из .env.example — известно каждому читателю:
 * с ним панель открылась бы, а ключ сессий подбирался бы в обход тормоза. */
const EXAMPLE_VALUES = new Set(['change-me-please', 'change-me-too-long-random-string']);
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const SESSION_SECRET = process.env.SESSION_SECRET;
if (!ADMIN_PASSWORD || EXAMPLE_VALUES.has(ADMIN_PASSWORD)) {
  console.error('ADMIN_PASSWORD не задан или взят из .env.example — сервер не запущен. '
    + 'Задайте свой пароль панели в переменных окружения.');
  process.exit(1);
}
if (!SESSION_SECRET || SESSION_SECRET.length < 32 || EXAMPLE_VALUES.has(SESSION_SECRET)) {
  console.error('SESSION_SECRET не задан, короче 32 символов или взят из .env.example — сервер не запущен. '
    + 'Сгенерируйте: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"');
  process.exit(1);
}
const SESSION_HOURS = 12;
const COOKIE = 'dorx_admin';

const FILES = {
  products: 'products.json',
  config: 'site-config.json',
  promos: 'promos.json',
};

/* ---------- хранилище ---------- */

function ensureDirs() {
  const dirs = [DATA_DIR, IMG_DIR, path.join(IMG_DIR, 'products'), path.join(IMG_DIR, 'promos')];
  for (const d of dirs) fs.mkdirSync(d, { recursive: true });
  for (const name of Object.values(FILES)) {
    const target = path.join(DATA_DIR, name);
    if (fs.existsSync(target)) continue;
    const seed = path.join(SEED_DIR, name);
    fs.writeFileSync(target, fs.existsSync(seed) ? fs.readFileSync(seed) : '[]');
  }
}

async function readJson(name, fallback) {
  try {
    return JSON.parse(await fsp.readFile(path.join(DATA_DIR, name), 'utf8'));
  } catch (e) {
    return fallback;
  }
}

/* Пишем через временный файл: обрыв на середине не оставит битый JSON. */
async function writeJson(name, value) {
  const target = path.join(DATA_DIR, name);
  const tmp = target + '.' + process.pid + '.tmp';
  await fsp.writeFile(tmp, JSON.stringify(value, null, 2), 'utf8');
  await fsp.rename(tmp, target);
}

/* ---------- вход в админку ---------- */

function sign(value) {
  return crypto.createHmac('sha256', SESSION_SECRET).update(String(value)).digest('hex');
}

function issueToken() {
  const exp = Date.now() + SESSION_HOURS * 3600 * 1000;
  return exp + '.' + sign(exp);
}

function tokenValid(token) {
  if (typeof token !== 'string') return false;
  const parts = token.split('.');
  if (parts.length !== 2) return false;
  if (Number(parts[0]) < Date.now()) return false;
  const good = Buffer.from(sign(parts[0]));
  const given = Buffer.from(parts[1]);
  return good.length === given.length && crypto.timingSafeEqual(good, given);
}

function passwordMatches(given) {
  const a = crypto.createHash('sha256').update(String(given == null ? '' : given)).digest();
  const b = crypto.createHash('sha256').update(ADMIN_PASSWORD).digest();
  return crypto.timingSafeEqual(a, b);
}

/* Простой тормоз для перебора пароля: пять промахов подряд — пауза 10 минут. */
const attempts = new Map();

function throttled(ip) {
  const rec = attempts.get(ip);
  return Boolean(rec && rec.until > Date.now());
}

function noteFailure(ip) {
  const now = Date.now();
  const rec = attempts.get(ip) || { n: 0, stamp: now, until: 0 };
  if (now - rec.stamp > 10 * 60 * 1000) rec.n = 0;
  rec.n += 1;
  rec.stamp = now;
  if (rec.n >= 5) {
    rec.until = now + 10 * 60 * 1000;
    rec.n = 0;
  }
  attempts.set(ip, rec);
}

function requireAuth(req, res, next) {
  if (tokenValid(req.cookies[COOKIE])) return next();
  res.status(401).json({ ok: false, error: 'Требуется вход' });
}

/* ---------- загрузка картинок ---------- */

const ALLOWED = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' };

function uploader(sub) {
  return multer({
    storage: multer.diskStorage({
      destination: function (req, file, cb) { cb(null, path.join(IMG_DIR, sub)); },
      filename: function (req, file, cb) {
        const stem = sub.slice(0, -1) + '_' + crypto.randomBytes(10).toString('hex');
        cb(null, stem + (ALLOWED[file.mimetype] || '.jpg'));
      },
    }),
    limits: { fileSize: 8 * 1024 * 1024, files: 20 },
    fileFilter: function (req, file, cb) { cb(null, Boolean(ALLOWED[file.mimetype])); },
  });
}

/* ---------- приложение ---------- */

ensureDirs();
const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(express.json({ limit: '2mb' }));
app.use(cookieParser());

/* Картинки живут на диске с данными, а не в репозитории. */
app.use('/images', express.static(IMG_DIR, { maxAge: '30d' }));

/* Живые данные всегда из DATA_DIR, чтобы админка и сайт не разъезжались. */
for (const key of Object.keys(FILES)) {
  const name = FILES[key];
  app.get('/' + name, async function (req, res) {
    res.set('Cache-Control', 'no-store');
    res.json(await readJson(name, key === 'config' ? {} : []));
  });
}

app.get('/healthz', function (req, res) { res.json({ ok: true }); });

/* Один сайт — один адрес. Пока домена не было, сайт жил на адресе Railway;
 * теперь оба адреса отдавали бы одно и то же, а поисковик считал бы это
 * двумя разными сайтами. Поэтому всё, что пришло не на CANONICAL_HOST,
 * переезжает на него навсегда. Проверку живости не трогаем: Railway стучится
 * по внутреннему адресу и переезд принял бы за поломку. */
const CANONICAL_HOST = (process.env.CANONICAL_HOST || '').trim().toLowerCase();

if (CANONICAL_HOST) {
  app.use(function (req, res, next) {
    /* Проверку живости и служебный API не трогаем. Переезд нужен людям и
     * поисковикам, а не программам: на постоянной переадресации POST
     * превращается в GET, и запись молча теряется. Заодно инструменты
     * работают по запасному адресу, даже если с главным что-то с DNS. */
    if (req.path === '/healthz' || req.path.indexOf('/api/') === 0) return next();
    const host = String(req.hostname || '').toLowerCase();
    if (!host || host === CANONICAL_HOST) return next();
    /* локальная разработка не должна уезжать на боевой домен */
    if (host === 'localhost' || host === '127.0.0.1' || host.endsWith('.local')) return next();
    res.redirect(301, 'https://' + CANONICAL_HOST + req.originalUrl);
  });
}

/* --- API админки --- */
const api = express.Router();

api.get('/check', function (req, res) {
  res.json({ ok: tokenValid(req.cookies[COOKIE]) });
});

api.post('/login', function (req, res) {
  const ip = req.ip || 'unknown';
  if (throttled(ip)) {
    return res.status(429).json({ ok: false, error: 'Слишком много попыток. Подождите 10 минут.' });
  }
  if (!passwordMatches(req.body && req.body.password)) {
    noteFailure(ip);
    return res.status(401).json({ ok: false, error: 'Неверный пароль' });
  }
  attempts.delete(ip);
  res.cookie(COOKIE, issueToken(), {
    httpOnly: true,
    sameSite: 'lax',
    secure: req.secure,
    maxAge: SESSION_HOURS * 3600 * 1000,
  });
  res.json({ ok: true });
});

api.post('/logout', function (req, res) {
  res.clearCookie(COOKIE);
  res.json({ ok: true });
});

api.get('/products', async function (req, res) { res.json(await readJson(FILES.products, [])); });
api.get('/config', async function (req, res) { res.json(await readJson(FILES.config, {})); });
api.get('/promos', async function (req, res) { res.json(await readJson(FILES.promos, [])); });

api.post('/save', requireAuth, async function (req, res) {
  const list = req.body;
  if (!Array.isArray(list)) return res.status(400).json({ ok: false, error: 'Ожидался список товаров' });
  await writeJson(FILES.products, list);
  res.json({ ok: true, count: list.length });
});

const CONFIG_KEYS = ['phone', 'phoneTel', 'whatsapp', 'instagram',
  'brandLine', 'heroTitle', 'heroSub', 'manifest'];

api.post('/save-config', requireAuth, async function (req, res) {
  const body = req.body || {};
  const current = await readJson(FILES.config, {});
  for (const key of CONFIG_KEYS) {
    if (typeof body[key] === 'string') current[key] = body[key].trim();
  }
  await writeJson(FILES.config, current);
  res.json({ ok: true, config: current });
});

api.post('/save-promos', requireAuth, async function (req, res) {
  const list = req.body;
  if (!Array.isArray(list)) return res.status(400).json({ ok: false, error: 'Ожидался список акций' });
  await writeJson(FILES.promos, list);
  res.json({ ok: true, count: list.length });
});

function mountUpload(route, sub) {
  api.post(route, requireAuth, uploader(sub).array('files', 20), function (req, res) {
    const urls = (req.files || []).map(function (f) { return '/images/' + sub + '/' + f.filename; });
    if (!urls.length) {
      return res.status(400).json({ ok: false, error: 'Подойдут только JPEG, PNG или WebP до 8 МБ' });
    }
    res.json({ ok: true, urls: urls, url: urls[0] });
  });
}

mountUpload('/upload', 'products');
mountUpload('/upload-promo', 'promos');

/* Демо-товары: наполнить витрину для примера и так же легко убрать. */
api.post('/seed-demo', requireAuth, async function (req, res) {
  let demo;
  try {
    demo = JSON.parse(await fsp.readFile(path.join(SEED_DIR, 'demo-products.json'), 'utf8'));
  } catch (e) {
    return res.status(500).json({ ok: false, error: 'Демо-товары не найдены' });
  }
  const list = await readJson(FILES.products, []);
  const have = {};
  list.forEach(function (p) { have[p.id] = true; });
  const added = demo.filter(function (p) { return !have[p.id]; });
  await writeJson(FILES.products, list.concat(added));
  res.json({ ok: true, added: added.length });
});

api.post('/drop-demo', requireAuth, async function (req, res) {
  const list = await readJson(FILES.products, []);
  const kept = list.filter(function (p) { return !p.demo; });
  await writeJson(FILES.products, kept);
  res.json({ ok: true, removed: list.length - kept.length });
});

app.use('/api', api);

/* Страницы не кешируем: правка разметки должна быть видна сразу, иначе
 * посетитель час смотрит старый сайт. Стили и скрипты живут дольше —
 * их адрес меняется через ?v= при каждом обновлении. */
app.use(express.static(PUBLIC_DIR, {
  extensions: ['html'],
  setHeaders: function (res, filePath) {
    if (/\.html$/i.test(filePath)) res.set('Cache-Control', 'no-cache');
    else if (/\.(css|js)$/i.test(filePath)) res.set('Cache-Control', 'public, max-age=3600');
    else res.set('Cache-Control', 'public, max-age=604800');
  },
}));

app.use(function (req, res) {
  res.status(404).sendFile(path.join(PUBLIC_DIR, '404.html'), function (err) {
    if (err) res.status(404).type('text/plain').send('Страница не найдена');
  });
});

app.use(function (err, req, res, next) {
  if (err && err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ ok: false, error: 'Файл больше 8 МБ' });
  }
  console.error(err);
  res.status(500).json({ ok: false, error: 'Внутренняя ошибка' });
});

app.listen(PORT, function () {
  console.log('DORX сайт слушает порт ' + PORT + ', данные в ' + DATA_DIR);
});
