'use strict';
/* Быстрая самопроверка: поднимает сервер на свободном порту, проходит по
 * основным адресам и по сценарию админки, затем гасит себя.
 * Запуск: node server/smoke.js
 */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const http = require('http');

const PORT = 3987;
const BASE = 'http://127.0.0.1:' + PORT;
const PASSWORD = 'smoke-test-password';
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'dorx-smoke-'));

let failures = 0;
const results = [];

function check(name, ok, detail) {
  results.push((ok ? 'OK   ' : 'FAIL ') + name + (detail ? '  — ' + detail : ''));
  if (!ok) failures += 1;
}

function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

async function ready() {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(BASE + '/healthz');
      if (r.ok) return true;
    } catch (e) { /* ещё не поднялся */ }
    await wait(250);
  }
  return false;
}

/* fetch не даёт подменить заголовок Host — он в списке запрещённых, — поэтому
 * для проверки переезда обращаемся к серверу напрямую. */
function rawGet(port, pathname, host) {
  return new Promise(function (resolve, reject) {
    const req = http.request(
      { host: '127.0.0.1', port: port, path: pathname, method: 'GET', headers: { Host: host } },
      function (res) {
        res.resume();
        res.on('end', function () { resolve({ status: res.statusCode, headers: res.headers }); });
      },
    );
    req.on('error', reject);
    req.end();
  });
}

/* Сервер обязан отказаться стартовать без пароля и ключа сессий или с
 * заглушками из .env.example: иначе панель открывалась бы значением,
 * известным любому читателю кода. patch — что задать, остальное удаляется. */
function refusesToStart(patch) {
  return new Promise(function (resolve) {
    const env = Object.assign({}, process.env, {
      PORT: String(PORT + 2),
      DATA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'dorx-nopass-')),
    });
    delete env.ADMIN_PASSWORD;
    delete env.SESSION_SECRET;
    Object.assign(env, patch || {});
    const proc = spawn(process.execPath, [path.join(__dirname, 'index.js')], { env: env, stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    proc.stderr.on('data', function (d) { stderr += d; });
    const timer = setTimeout(function () { proc.kill(); resolve({ code: null, stderr: stderr }); }, 8000);
    proc.on('exit', function (code) {
      clearTimeout(timer);
      fs.rmSync(env.DATA_DIR, { recursive: true, force: true });
      resolve({ code: code, stderr: stderr });
    });
  });
}

/* Поднимает отдельный сервер с CANONICAL_HOST и проверяет, что чужой адрес
 * уводит на главный, сам главный отвечает как обычно, а проверку живости
 * переезд не задевает. */
async function canonicalHostChecks() {
  const port = PORT + 1;
  const base = 'http://127.0.0.1:' + port;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dorx-canon-'));
  const proc = spawn(process.execPath, [path.join(__dirname, 'index.js')], {
    env: Object.assign({}, process.env, {
      PORT: String(port),
      DATA_DIR: dir,
      ADMIN_PASSWORD: PASSWORD,
      SESSION_SECRET: 'smoke-secret-0123456789abcdef-0123456789',
      CANONICAL_HOST: 'dorx.kz',
    }),
    stdio: 'ignore',
  });

  try {
    let up = false;
    for (let i = 0; i < 60; i++) {
      try {
        const r = await fetch(base + '/healthz', { headers: { Host: 'dorx.kz' } });
        if (r.ok) { up = true; break; }
      } catch (e) { /* ещё поднимается */ }
      await wait(250);
    }
    check('сервер с главным адресом поднялся', up);
    if (!up) return;

    const stray = await rawGet(port, '/catalogue/', 'dorx-example.up.railway.app');
    check('чужой адрес уводит на главный', stray.status === 301, 'статус ' + stray.status);
    check('уводит именно на dorx.kz с тем же путём',
      stray.headers.location === 'https://dorx.kz/catalogue/', String(stray.headers.location));

    const canonical = await rawGet(port, '/catalogue/', 'dorx.kz');
    check('главный адрес отвечает без переезда', canonical.status === 200, 'статус ' + canonical.status);

    const health = await rawGet(port, '/healthz', 'healthcheck.railway.app');
    check('проверка живости не уезжает', health.status === 200, 'статус ' + health.status);

    /* API не должен уезжать: на 301 POST превращается в GET и запись теряется */
    const api = await rawGet(port, '/api/check', 'dorx-example.up.railway.app');
    check('служебный API не уезжает', api.status === 200, 'статус ' + api.status);
  } finally {
    proc.kill();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const child = spawn(process.execPath, [path.join(__dirname, 'index.js')], {
  env: Object.assign({}, process.env, {
    PORT: String(PORT),
    DATA_DIR: DATA,
    ADMIN_PASSWORD: PASSWORD,
    SESSION_SECRET: 'smoke-secret-0123456789abcdef-0123456789',
  }),
  stdio: ['ignore', 'pipe', 'pipe'],
});

let serverLog = '';
child.stdout.on('data', function (b) { serverLog += b; });
child.stderr.on('data', function (b) { serverLog += b; });

(async function run() {
  if (!await ready()) {
    console.error('Сервер не поднялся.\n' + serverLog);
    process.exit(1);
  }

  /* страницы */
  for (const p of ['/', '/catalogue/', '/warranty/', '/terms/', '/privacy/', '/admin/']) {
    const r = await fetch(BASE + p);
    check('страница ' + p, r.status === 200, 'статус ' + r.status);
  }

  /* статика */
  for (const a of ['/assets/site.css', '/assets/app.js', '/assets/dorx-icon.svg', '/robots.txt']) {
    const r = await fetch(BASE + a);
    check('файл ' + a, r.status === 200, 'статус ' + r.status);
  }

  /* данные */
  const prod = await fetch(BASE + '/products.json');
  check('products.json отдаётся списком', prod.ok && Array.isArray(await prod.clone().json()));
  const cfg = await (await fetch(BASE + '/site-config.json')).json();
  check('site-config.json с настройками', Boolean(cfg && cfg.heroTitle));

  /* 404 */
  const miss = await fetch(BASE + '/net-takoy-stranicy/');
  check('несуществующая страница -> 404', miss.status === 404, 'статус ' + miss.status);

  /* защита записи */
  const denied = await fetch(BASE + '/api/save', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify([]),
  });
  check('запись без входа запрещена', denied.status === 401, 'статус ' + denied.status);

  /* неверный пароль */
  const badLogin = await fetch(BASE + '/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: 'ne-tot-parol' }),
  });
  check('неверный пароль отклонён', badLogin.status === 401, 'статус ' + badLogin.status);

  /* вход */
  const login = await fetch(BASE + '/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: PASSWORD }),
  });
  const cookie = (login.headers.get('set-cookie') || '').split(';')[0];
  check('вход по паролю', login.ok && cookie.indexOf('dorx_admin=') === 0);

  const auth = { 'Content-Type': 'application/json', Cookie: cookie };

  const checked = await (await fetch(BASE + '/api/check', { headers: { Cookie: cookie } })).json();
  check('сессия признаётся', checked.ok === true);

  /* сохранение товара */
  const item = {
    id: 'smoke-tovar', name: 'Смоук', sub: 'Проверка', category: 'home',
    price: 1000, priceInstallment: 42, images: [], specs: { 'Ключ': 'Значение' },
  };
  const saved = await (await fetch(BASE + '/api/save', {
    method: 'POST', headers: auth, body: JSON.stringify([item]),
  })).json();
  check('товар сохранён', saved.ok === true && saved.count === 1);

  const back = await (await fetch(BASE + '/products.json')).json();
  check('товар виден на сайте', back.length === 1 && back[0].name === 'Смоук');

  /* демо-товары */
  const demo = await (await fetch(BASE + '/api/seed-demo', {
    method: 'POST', headers: auth,
  })).json();
  check('демо-товары добавились', demo.ok === true && demo.added === 6, 'добавлено ' + demo.added);

  const dropped = await (await fetch(BASE + '/api/drop-demo', {
    method: 'POST', headers: auth,
  })).json();
  check('демо-товары убрались', dropped.ok === true && dropped.removed === 6);

  const after = await (await fetch(BASE + '/products.json')).json();
  check('настоящий товар остался', after.length === 1 && after[0].id === 'smoke-tovar');

  /* настройки */
  const savedCfg = await (await fetch(BASE + '/api/save-config', {
    method: 'POST', headers: auth,
    body: JSON.stringify({ phone: '+7 777 111 22 33', whatsapp: '+77771112233' }),
  })).json();
  check('настройки сохранились', savedCfg.ok && savedCfg.config.phone === '+7 777 111 22 33');
  check('текст героя не потерялся', Boolean(savedCfg.config.heroTitle));

  /* акции */
  const savedPromos = await (await fetch(BASE + '/api/save-promos', {
    method: 'POST', headers: auth,
    body: JSON.stringify([{ image: '/images/promos/x.png', title: 'Тест', code: 'DORX10', percent: 10 }]),
  })).json();
  check('акции сохранились', savedPromos.ok === true && savedPromos.count === 1);

  /* выход */
  const out = await fetch(BASE + '/api/logout', { method: 'POST', headers: { Cookie: cookie } });
  check('выход из админки', out.ok);

  /* второй сервер — с заданным главным адресом */
  await canonicalHostChecks();

  /* дальше — серверы, которые обязаны упасть на старте, а не открыть панель */
  const refused = function (r) { return r.code !== null && r.code !== 0; };
  const nopass = await refusesToStart({});
  check('без ADMIN_PASSWORD сервер не стартует', refused(nopass), 'код выхода ' + nopass.code);
  check('причина отказа названа', /ADMIN_PASSWORD/.test(nopass.stderr));
  const nosecret = await refusesToStart({ ADMIN_PASSWORD: PASSWORD });
  check('без SESSION_SECRET сервер не стартует', refused(nosecret), 'код выхода ' + nosecret.code);
  check('названа причина — SESSION_SECRET', /SESSION_SECRET/.test(nosecret.stderr));
  const short = await refusesToStart({ ADMIN_PASSWORD: PASSWORD, SESSION_SECRET: 'short' });
  check('короткий SESSION_SECRET не принимается', refused(short), 'код выхода ' + short.code);
  const example = await refusesToStart({
    ADMIN_PASSWORD: 'change-me-please', SESSION_SECRET: 'smoke-secret-0123456789abcdef-0123456789',
  });
  check('пароль из .env.example не принимается', refused(example), 'код выхода ' + example.code);

  console.log(results.join('\n'));
  console.log('\n' + (failures ? failures + ' проверок не прошло' : 'Все проверки прошли'));
  child.kill();
  fs.rmSync(DATA, { recursive: true, force: true });
  process.exit(failures ? 1 : 0);
})().catch(function (err) {
  console.error(err);
  console.error(serverLog);
  child.kill();
  process.exit(1);
});
