process.env.USERS_DB = ':memory:';
process.env.BOT_MS = '2'; process.env.RESOLVE_MS = '2'; process.env.NEXT_MS = '2';
const { JSDOM } = require('jsdom');
const fs = require('fs'), path = require('path'), WS = require('ws');
const { server } = require('./server.js');
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
  // register a real account (guests can't have friends)
  doc.getElementById('home-login').click(); await tick(50);
  const uname = 'Feat' + (Date.now() % 100000);
  doc.getElementById('auth-user').value = uname;
  doc.getElementById('auth-pass').value = 'secret123';
  click(doc.getElementById('register-btn')); await tick(400);
  if (!vis('app')) errs.push('did not sign in');

  // 1) game log gone, chat remains
  if (doc.getElementById('game-log')) errs.push('GAME LOG panel still present');
  if (!doc.getElementById('game-chat')) errs.push('chat panel missing');

  // 2) join box is NOT on the home screen
  if (doc.querySelector('#entry-screen #join-code')) errs.push('join-by-code still on home screen');

  // 3) Play with Friends opens a screen offering create AND join
  click(doc.querySelector('.feature-card.green')); await tick(120);
  if (!vis('friends-screen')) errs.push('Play with Friends screen did not open');
  if (!doc.getElementById('create-room-btn')) errs.push('missing Create room');
  if (!doc.getElementById('join-form')) errs.push('missing Join room');

  // 4) merged Profile & Settings
  click([...doc.querySelectorAll('.nav-item')].find((a) => /Profile/.test(a.textContent))); await tick(120);
  if (!vis('settings-screen')) errs.push('Profile & Settings did not open');
  if (!doc.getElementById('set-colorblind')) errs.push('settings controls missing from profile screen');
  if (!/Bronze|Silver|Gold|Diamond|Legend/.test(txt('st-tier'))) errs.push('profile stats missing: ' + txt('st-tier'));

  // 5) friends: add a friend by name
  const other = 'Pal' + (Date.now() % 100000);
  await new Promise((res) => {
    const ws2 = new WS('ws://localhost:' + port);
    ws2.on('open', () => ws2.send(JSON.stringify({ t: 'register', user: other, pass: 'secret123' })));
    ws2.on('message', () => res());
  });
  click([...doc.querySelectorAll('.nav-item')].find((a) => /Home/.test(a.textContent))); await tick(150);
  doc.getElementById('friend-name').value = other;
  submit(doc.getElementById('add-friend-form')); await tick(300);
  const fl = txt('players-list');
  if (!fl.includes(other)) errs.push('friend not listed after adding: ' + fl);
  else console.log('  friends panel ->', fl.replace(/\s+/g, ' ').trim().slice(0, 60));

  // 6) quick match hides the room code
  click(doc.querySelector('.feature-card.teal')); await tick(300);
  if (!vis('lobby-screen')) errs.push('quick match did not reach lobby');
  if (vis('lobby-code-box')) errs.push('quick match should NOT show a room code');
  if (!/MATCHMAKING/.test(txt('lobby-label'))) errs.push('quick match label wrong: ' + txt('lobby-label'));

  // 7) private room DOES show the code
  click([...doc.querySelectorAll('.nav-item')].find((a) => /Play with Friends/.test(a.textContent))); await tick(150);
  click(doc.getElementById('create-room-btn')); await tick(300);
  if (!vis('lobby-code-box')) errs.push('private room should show its code');
  if (!/^[A-Z0-9]{4}$/.test(txt('room-code'))) errs.push('bad room code: ' + txt('room-code'));

  // 8) remove-bot works from the UI
  click(doc.getElementById('fill-bots-btn')); await tick(250);
  const removeBtns = [...doc.querySelectorAll('#seat-list .kick')].filter((b) => /remove/i.test(b.textContent));
  if (!removeBtns.length) errs.push('no remove-bot buttons rendered');
  else {
    click(removeBtns[0]); await tick(250);
    if (!/Empty seat/.test(txt('seat-list'))) errs.push('remove bot did not free the seat');
    else console.log('  remove bot -> seat freed');
  }

  // 9) trump card flips + announces on reveal
  click(doc.getElementById('fill-bots-btn')); await tick(200);
  click(doc.getElementById('start-btn')); await tick(250);
  let steps = 0, sawFlip = false, sawAnnounce = false;
  while (steps++ < 8000) {
    if (doc.querySelector('.trump-announce')) sawAnnounce = true;
    if (doc.getElementById('trump-card') && doc.getElementById('trump-card').classList.contains('flipped')) sawFlip = true;
    if ([...doc.querySelectorAll('#controls button')].some((b) => /Back to home/.test(b.textContent))) break;
    const pass = doc.querySelector('.pass-btn'), trump = doc.querySelector('.trump-btn'),
      reveal = doc.querySelector('.reveal-btn'), play = doc.querySelector('#hand .card.playable');
    if (pass) click(pass); else if (trump) click(trump);
    else if (reveal) click(reveal); else if (play) click(play);
    await tick(4);
  }
  if (!sawFlip) errs.push('trump card never flipped face-up');
  if (!sawAnnounce) errs.push('no trump reveal announcement appeared');
  if (!doc.getElementById('match-score')) errs.push('match score missing');

  if (errs.length) { console.log('ERRORS:\n' + errs.join('\n')); process.exit(1); }
  console.log('NEW FEATURES OK: log removed, trump card flips + announces, friends work, profile merged, quick-match hides code, private room shows code, remove-bot works');
  process.exit(0);
});
