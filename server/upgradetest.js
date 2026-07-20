process.env.USERS_DB = ':memory:';
process.env.BOT_MS = '2'; process.env.RESOLVE_MS = '2'; process.env.NEXT_MS = '2';
const { JSDOM } = require('jsdom');
const fs = require('fs'), path = require('path'), WS = require('ws');
const { server } = require('./server.js');
const store = require('./db');
const ROOT = path.join(__dirname, '..');
const errs = [];
const tick = (ms) => new Promise((r) => setTimeout(r, ms));

server.listen(0, async () => {
  const port = server.address().port;
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8')
    .replace(/<link[^>]*>/g, '').replace(/<script[^>]*><\/script>/g, '');
  const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, url: 'http://localhost:' + port + '/' });
  const w = dom.window; w.WebSocket = WS;
  w.addEventListener('error', (e) => errs.push('win.error: ' + ((e.error && e.error.stack) || e.message)));
  for (const f of ['config.js', 'cards.js', 'sound.js', 'online.js']) {
    const s = w.document.createElement('script');
    s.textContent = fs.readFileSync(path.join(ROOT, f), 'utf8');
    w.document.body.appendChild(s);
  }
  const doc = w.document;
  const vis = (id) => !doc.getElementById(id).classList.contains('hidden');
  const txt = (id) => doc.getElementById(id).textContent;
  const click = (el) => el && el.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  const submit = (el) => el && el.dispatchEvent(new w.Event('submit'));

  await tick(200);

  // Season Pass must be gone
  if (/SEASON PASS|VIEW PASS/i.test(doc.body.textContent)) errs.push('Season Pass still present');
  if (doc.getElementById('sp-bar')) errs.push('season pass bar still in DOM');

  // start as a guest and earn something
  click(doc.getElementById('home-guest')); await tick(250);
  const guestName = w.eval('me.name');
  if (!/^Guest-/.test(guestName)) errs.push('did not start as guest: ' + guestName);
  click(doc.getElementById('daily-btn')); await tick(250);   // +100 coins
  const coinsAsGuest = Number(txt('tb-coins'));
  if (coinsAsGuest !== 100) errs.push('guest did not earn coins: ' + coinsAsGuest);

  // the upgrade form should be offered to guests on Profile & Settings
  click([...doc.querySelectorAll('.nav-item')].find((a) => /Profile/.test(a.textContent))); await tick(150);
  if (!vis('upgrade-form')) errs.push('guests are not offered account creation');

  // reject a bad name, staying on the screen
  doc.getElementById('up-user').value = 'x';
  doc.getElementById('up-pass').value = '123';
  submit(doc.getElementById('upgrade-form')); await tick(300);
  if (!txt('up-msg')) errs.push('validation error not shown on upgrade form');
  if (!vis('settings-screen')) errs.push('failed upgrade navigated away');
  console.log('  invalid upgrade ->', JSON.stringify(txt('up-msg')));

  // now upgrade for real
  const name = 'Real' + (Date.now() % 100000);
  doc.getElementById('up-user').value = name;
  doc.getElementById('up-pass').value = 'secret123';
  submit(doc.getElementById('upgrade-form')); await tick(500);

  if (w.eval('me.guest')) errs.push('still flagged as a guest after upgrading');
  if (w.eval('me.name') !== name) errs.push('name did not change: ' + w.eval('me.name'));
  const coinsAfter = Number(txt('tb-coins'));
  if (coinsAfter !== coinsAsGuest) errs.push('progress lost on upgrade: ' + coinsAsGuest + ' -> ' + coinsAfter);
  if (vis('upgrade-form')) errs.push('upgrade form still offered after upgrading');
  console.log('  upgraded', guestName, '->', name, '| coins kept:', coinsAfter);

  // it must be a real, persisted account you can log into
  const persisted = store.loadAllUsers();
  const row = Object.values(persisted.users).find((u) => u.name === name);
  if (!row) errs.push('account not written to the database');
  else if (row.stats.coins !== coinsAsGuest) errs.push('DB stats do not match: ' + row.stats.coins);

  const ok = await new Promise((res) => {
    const ws2 = new WS('ws://localhost:' + port);
    ws2.on('open', () => ws2.send(JSON.stringify({ t: 'login', user: name, pass: 'secret123' })));
    ws2.on('message', (d) => { const m = JSON.parse(d); res(m.t === 'authOk' ? m : null); });
    setTimeout(() => res(null), 4000);
  });
  if (!ok) errs.push('cannot log in with the new account');
  else console.log('  logged back in as', ok.user, '| coins', ok.stats.coins, '| trophies', ok.stats.rating);

  if (errs.length) { console.log('ERRORS:\n' + errs.join('\n')); process.exit(1); }
  console.log('ACCOUNTS OK: Season Pass removed; guests can create an account, keep their progress, and log back in');
  process.exit(0);
});
