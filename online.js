// Online client for Twenty-Nine. Server-authoritative; renders from server
// messages. Reuses SUIT_SYMBOL / SUIT_COLOR (cards.js) and Sound (sound.js).

const TOKEN_KEY = 'twentynine-token';
const CODE_KEY = 'twentynine-room';
const SEATNAME = (s) => 'Seat ' + (s + 1);
let ws = null;
let me = { seat: null, code: null, name: null, host: false, guest: false, stats: null };
let last = null;
let authMode = 'token';

const $ = (id) => document.getElementById(id);

function show(screen) {
  const overlays = ['home-screen', 'auth-screen'];
  const views = ['entry-screen', 'lobby-screen', 'game-screen', 'learn-screen', 'settings-screen'];
  overlays.forEach((s) => $(s).classList.toggle('hidden', s !== screen));
  const inApp = views.includes(screen);
  $('app').classList.toggle('hidden', !inApp);
  views.forEach((s) => $(s).classList.toggle('hidden', s !== screen));
  $('chat').classList.toggle('hidden', screen !== 'lobby-screen');
  document.querySelectorAll('.nav-item, .bn-item').forEach((el) =>
    el.classList.toggle('active', el.dataset.view === screen));
  if (screen === 'entry-screen') sendRaw({ t: 'home' });
  if (screen === 'learn-screen') buildLearn();
  if (screen === 'settings-screen') {
    const a = $('set-account');
    if (a) a.textContent = me.guest
      ? 'Playing as a guest (' + me.name + '). Create an account to keep your rank and stats.'
      : 'Signed in as ' + (me.name || '—') + '.';
  }
}
function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.add('hidden'), 2600);
}
function closeSidebar() { $('sidebar').classList.remove('open'); }

// ---------- connection ----------
/**
 * Where the game server lives. Defaults to the page's own origin (correct when
 * the Node server serves the site). Override when the front end is hosted
 * somewhere that can't run a WebSocket server (e.g. Vercel):
 *   - set `window.TWENTYNINE_SERVER = 'my-app.onrender.com'` in config.js, or
 *   - append ?server=my-app.onrender.com once (it is remembered).
 * @returns {string} ws:// or wss:// URL
 */
function backendUrl() {
  const qs = new URLSearchParams(location.search).get('server');
  if (qs) { try { localStorage.setItem('twentynine-server', qs); } catch (e) {} }
  let cfg = qs || (typeof window !== 'undefined' && window.TWENTYNINE_SERVER) || '';
  if (!cfg) { try { cfg = localStorage.getItem('twentynine-server') || ''; } catch (e) {} }
  if (cfg) {
    cfg = cfg.trim().replace(/\/+$/, '');
    if (/^wss?:\/\//.test(cfg)) return cfg;
    if (/^https:\/\//.test(cfg)) return cfg.replace(/^https:/, 'wss:');
    if (/^http:\/\//.test(cfg)) return cfg.replace(/^http:/, 'ws:');
    return (location.protocol === 'https:' ? 'wss://' : 'ws://') + cfg;
  }
  return (location.protocol === 'https:' ? 'wss:' : 'ws:') + '//' + location.host;
}

function connect() {
  ws = new WebSocket(backendUrl());
  ws.onopen = () => {
    const tok = localStorage.getItem(TOKEN_KEY);
    if (tok) { authMode = 'token'; sendRaw({ t: 'auth', token: tok }); }
    else show('home-screen');
  };
  ws.onmessage = (e) => onMessage(JSON.parse(e.data));
  ws.onclose = () => toast('Disconnected. Reload to reconnect.');
  ws.onerror = () => toast('Cannot reach server. Start it and open http://localhost:8030');
}
// Queue while connecting so a click during handshake is not lost.
let pending = [];
function sendRaw(o) {
  if (ws && ws.readyState === 1) { ws.send(JSON.stringify(o)); return; }
  if (ws && ws.readyState === 0) { pending.push(o); return; }
  // Most common cause: the page was opened from a plain file/static server that
  // has no WebSocket. Name the mismatch instead of a vague failure.
  toast('Not connected. Open the game from the server (default http://localhost:8030) — this page is on ' + (location.host || 'file://'));
}
function action(a) { Sound.init(); sendRaw(Object.assign({ t: 'action' }, a)); }

// ---------- rank tiers / progression ----------
const TIERS = [
  { name: 'Bronze', min: 0, color: '#cd7f32' },
  { name: 'Silver', min: 1000, color: '#c8ccd0' },
  { name: 'Gold', min: 1150, color: '#f3c34a' },
  { name: 'Diamond', min: 1300, color: '#5ad1e6' },
  { name: 'Legend', min: 1500, color: '#b06bff' },
];
function tierInfo(rating) {
  let idx = 0;
  for (let i = 0; i < TIERS.length; i++) if (rating >= TIERS[i].min) idx = i;
  const cur = TIERS[idx], next = TIERS[idx + 1] || null;
  const span = next ? next.min - cur.min : 1;
  const pct = next ? Math.max(0, Math.min(1, (rating - cur.min) / span)) : 1;
  return { cur, next, pct };
}
const levelOf = (xp) => Math.floor((xp || 0) / 500) + 1;
const xpPct = (s) => ((s.xp || 0) % 500) / 500 * 100;
function setAvatar(id, ch, color) { const a = $(id); if (a) { a.textContent = ch; a.style.background = color; } }

function renderDashboard() {
  const s = me.stats;
  if (!s) return;
  const ti = tierInfo(s.rating);
  const initial = (me.name || '?')[0].toUpperCase();
  const label = me.name + (me.guest ? ' · guest' : '');

  // top bar
  setAvatar('tb-avatar', initial, ti.cur.color);
  $('tb-name').textContent = label;
  $('tb-rank').textContent = ti.cur.name;
  $('tb-xp-bar').style.width = xpPct(s) + '%';
  $('tb-coins').textContent = s.coins || 0;
  $('tb-gems').textContent = s.gems || 0;

  // sidebar mini-profile
  setAvatar('sb-avatar', initial, ti.cur.color);
  $('sb-name').textContent = me.name;
  $('sb-rank').textContent = ti.cur.name + ' · ' + s.rating;
  $('sb-xp-bar').style.width = xpPct(s) + '%';

  // ranked feature card
  $('rc-emblem').style.color = ti.cur.color;
  $('rc-tier').textContent = ti.cur.name;
  $('rc-rating').textContent = '🏆 ' + s.rating;

  // profile card
  setAvatar('pf-avatar', initial, ti.cur.color);
  $('pf-name').textContent = me.name;
  $('pf-tier').textContent = ti.cur.name + ' · ' + s.rating;
  $('pf-tier').style.color = ti.cur.color;
  $('pf-matches').textContent = s.games || 0;
  $('pf-wins').textContent = s.wins || 0;
  $('pf-winrate').textContent = (s.games ? Math.round(100 * s.wins / s.games) : 0) + '%';
  $('pf-highbid').textContent = s.highestBid || '—';
  $('pf-streak').textContent = s.bestStreak || 0;
  $('pf-rating').textContent = s.rating;

  // season pass progress (placeholder: XP within a 1000 goal)
  $('sp-bar').style.width = Math.min(100, ((s.xp || 0) % 1000) / 10) + '%';

  renderDaily();
  renderSeason();
  renderMatches(s.matches || []);
}
function renderDaily() {
  const btn = $('daily-btn'); const s = me.stats; if (!s) return;
  const ready = !s.lastDaily || (Date.now() - s.lastDaily) >= 20 * 3600 * 1000;
  btn.disabled = !ready;
  btn.textContent = ready ? 'Claim' : 'Claimed';
  $('daily-sub').textContent = ready ? 'Claim your reward' : 'Come back tomorrow';
}
function seasonEnd() {
  const n = new Date(); const q = Math.floor(n.getMonth() / 3);
  return new Date(n.getFullYear(), q * 3 + 3, 0, 23, 59, 59);
}
function renderSeason() {
  const ms = seasonEnd() - new Date();
  const d = Math.floor(ms / 86400000), h = Math.floor((ms % 86400000) / 3600000);
  $('season').textContent = 'Ends in ' + d + 'd ' + h + 'h';
}
setInterval(renderSeason, 60000);

function renderMatches(matches) {
  const el = $('match-list');
  el.innerHTML = '';
  if (!matches.length) { el.innerHTML = '<div class="empty">No matches yet — play a game!</div>'; return; }
  matches.forEach((mt) => {
    const row = document.createElement('div');
    row.className = 'match-row';
    const res = document.createElement('span');
    res.className = 'res ' + mt.r;
    res.textContent = mt.r === 'W' ? 'Victory' : 'Defeat';
    const mid = document.createElement('span');
    mid.className = 'mid';
    mid.textContent = 'Bid ' + mt.bid + ' · ' + (mt.made ? 'made' : 'set') + ' · with ' + mt.partner;
    const dl = document.createElement('span');
    dl.className = 'delta ' + (mt.delta >= 0 ? 'up' : 'down');
    dl.textContent = (mt.delta >= 0 ? '+' : '') + mt.delta;
    row.appendChild(res); row.appendChild(mid); row.appendChild(dl);
    el.appendChild(row);
  });
}
function renderHome(m) {
  const pl = $('players-list');
  pl.innerHTML = '';
  const online = m.online || [];
  if (!online.length) pl.innerHTML = '<div class="empty">Just you for now.</div>';
  online.forEach((n) => {
    const d = document.createElement('div');
    d.className = 'player-online';
    const dot = document.createElement('span'); dot.className = 'dot';
    const nm = document.createElement('span'); nm.textContent = n + (n === me.name ? ' (you)' : '');
    d.appendChild(dot); d.appendChild(nm);
    pl.appendChild(d);
  });
  const lb = $('leaderboard-list');
  lb.innerHTML = '';
  const board = m.leaderboard || [];
  if (!board.length) lb.innerHTML = '<div class="empty">No ranked players yet.</div>';
  board.forEach((r) => {
    const row = document.createElement('div');
    row.className = 'lb-row';
    const rk = document.createElement('span'); rk.className = 'lb-rank'; rk.textContent = r.rank;
    const nm = document.createElement('span'); nm.className = 'lb-name'; nm.textContent = r.name;
    const rt = document.createElement('span'); rt.className = 'lb-rating'; rt.textContent = r.rating;
    row.appendChild(rk); row.appendChild(nm); row.appendChild(rt);
    lb.appendChild(row);
  });
}

// ---------- messages ----------
function onMessage(m) {
  switch (m.t) {
    case 'authOk':
      me.name = m.user; me.stats = m.stats; me.guest = !!m.guest;
      if (m.guest) localStorage.removeItem(TOKEN_KEY); else localStorage.setItem(TOKEN_KEY, m.token);
      $('whoami').textContent = m.user;
      renderDashboard();
      $('auth-msg').textContent = '';
      show('entry-screen');
      { const c = localStorage.getItem(CODE_KEY); if (c) sendRaw({ t: 'rejoin', code: c }); }
      break;
    case 'home':
      renderHome(m);
      break;
    case 'noRoom':
      localStorage.removeItem(CODE_KEY);
      show('entry-screen');
      break;
    case 'chat':
      addChat(m.from, m.text, m.seat === me.seat);
      break;
    case 'stats':
      me.stats = m.stats;
      renderDashboard();
      toast('+' + m.xpGain + ' XP · +' + m.coinGain + ' 🪙 · Rating ' + (m.delta >= 0 ? '+' : '') + m.delta);
      break;
    case 'daily':
      me.stats = m.stats;
      renderDashboard();
      toast(m.granted ? ('Daily reward! +' + m.coins + ' 🪙  +' + m.xp + ' XP') : 'Daily already claimed');
      break;
    case 'authErr':
      localStorage.removeItem(TOKEN_KEY);
      if (authMode === 'token') show('home-screen');
      else { $('auth-msg').textContent = m.msg; show('auth-screen'); }
      break;
    case 'joined':
      me.code = m.code; me.seat = m.seat;
      localStorage.setItem(CODE_KEY, m.code);
      $('room-code').textContent = m.code;
      show('lobby-screen');
      break;
    case 'room':
      renderLobby(m);
      break;
    case 'state':
      last = m; me.seat = m.you; me.host = (m.hostSeat === m.you);
      if ($('game-screen').classList.contains('hidden')) show('game-screen');
      renderGame(m);
      break;
    case 'error':
      toast(m.msg);
      break;
  }
}

// ---------- splash / auth ----------
$('home-guest').onclick = () => { Sound.init(); authMode = 'guest'; sendRaw({ t: 'guest' }); };
$('home-login').onclick = () => { $('auth-msg').textContent = ''; show('auth-screen'); };
$('auth-back').onclick = (e) => { e.preventDefault(); show('home-screen'); };
$('login-btn').onclick = () => { Sound.init(); authMode = 'form'; sendRaw({ t: 'login', user: $('auth-user').value.trim(), pass: $('auth-pass').value }); };
$('register-btn').onclick = () => { Sound.init(); authMode = 'form'; sendRaw({ t: 'register', user: $('auth-user').value.trim(), pass: $('auth-pass').value }); };
$('auth-pass').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('login-btn').click(); });

// ---------- nav ----------
$('menu-btn').onclick = () => $('sidebar').classList.toggle('open');
document.querySelectorAll('[data-view]').forEach((el) => el.onclick = () => {
  const v = el.dataset.view;
  if (v === 'profile-jump') { show('entry-screen'); $('profile-jump').scrollIntoView({ behavior: 'smooth' }); }
  else show(v);
  closeSidebar();
});
document.querySelectorAll('[data-act]').forEach((el) => el.onclick = (e) => {
  e.stopPropagation();
  const a = el.dataset.act;
  if (a === 'create') { Sound.init(); sendRaw({ t: 'createRoom' }); }
  else if (a === 'ranked') { show('entry-screen'); toast('Ranked uses your rating — climb to Legend!'); }
  closeSidebar();
});
document.querySelectorAll('[data-soon]').forEach((el) => el.onclick = (e) => {
  e.stopPropagation(); toast(el.dataset.soon + ' — coming soon'); closeSidebar();
});

// ---------- dashboard actions ----------
$('daily-btn').onclick = (e) => { e.stopPropagation(); Sound.init(); sendRaw({ t: 'claimDaily' }); };
$('signout').onclick = () => { localStorage.removeItem(TOKEN_KEY); localStorage.removeItem(CODE_KEY); location.reload(); };
$('join-btn').onclick = () => {
  const code = $('join-code').value.trim().toUpperCase();
  if (code.length === 4) sendRaw({ t: 'joinRoom', code });
  else $('entry-msg').textContent = 'Enter a 4-letter code';
};
$('join-code').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('join-btn').click(); });

// ---------- lobby ----------
function renderLobby(m) {
  me.host = (m.hostSeat === me.seat);
  $('room-code').textContent = m.code;
  const list = $('seat-list');
  list.innerHTML = '';
  let filled = 0;
  m.seats.forEach((s, i) => {
    if (s) filled++;
    const row = document.createElement('div');
    row.className = 'seat-row' + (i === me.seat ? ' you' : '');
    const team = document.createElement('span');
    team.className = 'badge';
    team.textContent = (i % 2 === 0 ? 'Team A' : 'Team B');
    const name = document.createElement('span');
    name.className = 'name' + (s ? '' : ' empty');
    name.textContent = s ? (s.bot ? '🤖 ' + s.name : s.name + (i === me.seat ? ' (you)' : '')) : 'empty';
    if (s && !s.bot && s.rating != null) name.textContent += ' · ' + s.rating;
    row.appendChild(team); row.appendChild(name);
    if (i === m.hostSeat) { const h = document.createElement('span'); h.className = 'badge'; h.textContent = 'host'; row.appendChild(h); }
    if (me.host && s && s.bot) { const k = document.createElement('button'); k.className = 'kick'; k.textContent = 'remove'; k.onclick = () => sendRaw({ t: 'removeSeat', seat: i }); row.appendChild(k); }
    if (me.host && !s) { const b = document.createElement('button'); b.className = 'kick'; b.textContent = '+ bot'; b.onclick = () => sendRaw({ t: 'addBot', seat: i }); row.appendChild(b); }
    list.appendChild(row);
  });
  $('host-controls').classList.toggle('hidden', !me.host);
  $('start-btn').disabled = filled < 4;
  $('lobby-wait').textContent = me.host
    ? (filled < 4 ? 'Fill all 4 seats (invite friends or add bots) to start.' : 'Ready — press Start.')
    : 'Waiting for the host to start…';
}
$('fill-bots-btn').onclick = () => sendRaw({ t: 'fillBots' });
$('start-btn').onclick = () => { Sound.init(); sendRaw({ t: 'start' }); };
$('leave-btn').onclick = () => { sendRaw({ t: 'leave' }); localStorage.removeItem(CODE_KEY); show('entry-screen'); };

// ---------- chat (floating + game panel) ----------
function addChat(from, text, mine) {
  ['chat-log', 'game-chat-log'].forEach((id) => {
    const log = $(id); if (!log) return;
    const line = document.createElement('div');
    const f = document.createElement('span'); f.className = 'from'; f.textContent = (mine ? 'You' : from) + ': ';
    const t = document.createElement('span'); t.textContent = text;
    line.appendChild(f); line.appendChild(t);
    log.appendChild(line); log.scrollTop = log.scrollHeight;
    while (log.children.length > 60) log.removeChild(log.firstChild);
  });
}
function sendChat(inp) { const t = inp.value.trim(); if (t) sendRaw({ t: 'chat', text: t }); inp.value = ''; }
$('chat-form').addEventListener('submit', (e) => { e.preventDefault(); sendChat($('chat-input')); });
$('game-chat-form').addEventListener('submit', (e) => { e.preventDefault(); sendChat($('game-chat-input')); });
$('log-tab').onclick = () => { $('log-tab').classList.add('active'); $('chat-tab').classList.remove('active'); $('game-log').classList.remove('hidden'); $('game-chat').classList.add('hidden'); };
$('chat-tab').onclick = () => { $('chat-tab').classList.add('active'); $('log-tab').classList.remove('active'); $('game-chat').classList.remove('hidden'); $('game-log').classList.add('hidden'); };

// ---------- game ----------
function cardEl(card, { playable = false, onClick = null } = {}) {
  const d = document.createElement('div');
  // suit-<name> lets the colour-blind (four-colour) mode restyle each suit
  d.className = 'card ' + SUIT_COLOR[card.suit] + ' suit-' + card.suit;
  d.innerHTML = '<span class="rank">' + card.rank + '</span><span class="suit">' + SUIT_SYMBOL[card.suit] + '</span>';
  if (playable) { d.classList.add('playable'); d.addEventListener('click', onClick); }
  else d.classList.add('disabled');
  return d;
}

let _lastNarr = '';
function pushLog(m) {
  if (!m.narration || m.narration === _lastNarr) return;
  _lastNarr = m.narration;
  const el = $('game-log');
  const d = document.createElement('div'); d.className = 'log-line'; d.textContent = m.narration;
  el.appendChild(d); el.scrollTop = el.scrollHeight;
  while (el.children.length > 60) el.removeChild(el.firstChild);
}

function renderGame(m) {
  const yourTurn = (m.turn === m.you) && !m.resolving;
  const myTeam = m.you % 2;

  // side panels
  $('pts-us').textContent = m.roundCardPoints[myTeam];
  $('pts-them').textContent = m.roundCardPoints[1 - myTeam];
  $('pts-target').textContent = (m.highBidder != null ? m.highBid : '—');
  const trumpEl = $('gv-trump');
  if (m.trumpRevealed) { trumpEl.textContent = SUIT_SYMBOL[m.trumpSuit]; }
  else if (m.trumpSuit) { trumpEl.textContent = SUIT_SYMBOL[m.trumpSuit] + ' (you)'; }
  else { trumpEl.textContent = 'Hidden'; }
  trumpEl.style.color = m.trumpSuit
    ? ((m.trumpSuit === 'hearts' || m.trumpSuit === 'diamonds') ? '#e0564c' : '#e8f0ea')
    : '#9fb2a8';
  const bidTeam = m.highBidder != null ? m.highBidder % 2 : null;
  $('gv-bid-you').textContent = (bidTeam === myTeam) ? m.highBid : '—';
  $('gv-bid-opp').textContent = (bidTeam === (1 - myTeam)) ? m.highBid : '—';
  pushLog(m);

  renderTrick(m);

  // hand
  const hand = $('hand');
  hand.innerHTML = '';
  const legal = m.legal || [];
  (m.hand || []).forEach((c, i) => {
    const ok = yourTurn && m.phase === 'play' && legal.includes(c.id);
    const node = cardEl(c, { playable: ok, onClick: ok ? () => { Sound.card(); action({ action: 'play', cardId: c.id }); } : null });
    node.style.animationDelay = (i * 0.03) + 's';
    hand.appendChild(node);
  });

  // controls
  const ctr = $('controls');
  ctr.innerHTML = '';
  if (m.gameWinner != null) return renderGameOver(m);

  if (yourTurn && m.phase === 'bidding' && m.canBid) {
    const wrap = document.createElement('div'); wrap.className = 'bid-controls';
    const row = document.createElement('div'); row.className = 'bid-row';
    for (let b = m.minBid; b <= 28; b++) {
      const btn = document.createElement('button'); btn.className = 'bid-btn'; btn.textContent = b;
      btn.onclick = () => { Sound.bid(); action({ action: 'bid', amount: b }); };
      row.appendChild(btn);
    }
    wrap.appendChild(row);
    const pass = document.createElement('button'); pass.className = 'pass-btn'; pass.textContent = 'Pass';
    pass.onclick = () => { Sound.bid(); action({ action: 'pass' }); };
    wrap.appendChild(pass);
    ctr.appendChild(wrap);
  } else if (yourTurn && m.phase === 'chooseTrump' && m.trumpChoices) {
    const row = document.createElement('div'); row.className = 'trump-row';
    for (const suit of m.trumpChoices) {
      const btn = document.createElement('button'); btn.className = 'trump-btn ' + SUIT_COLOR[suit];
      btn.innerHTML = SUIT_SYMBOL[suit];
      btn.onclick = () => action({ action: 'trump', suit });
      row.appendChild(btn);
    }
    ctr.appendChild(row);
  } else if (yourTurn && m.phase === 'play' && m.canReveal) {
    const btn = document.createElement('button'); btn.className = 'reveal-btn'; btn.textContent = 'Reveal Trump';
    btn.onclick = () => { Sound.reveal(); action({ action: 'reveal' }); };
    ctr.appendChild(btn);
  }

  const turnName = m.resolving ? 'Resolving trick…' : (yourTurn ? 'Your turn' : nameOf(m, m.turn) + '’s turn');
  $('player-label').className = yourTurn ? 'turn-you' : '';
  $('player-label').textContent = turnName + (m.phase === 'play' ? ' · trick ' + (m.trickCount + 1) + '/8' : '');
  $('table-message').textContent = m.phase === 'play' && m.ledSuit
    ? 'Led: ' + SUIT_SYMBOL[m.ledSuit] + (m.mustPlayTrump ? ' · must play trump' : '')
    : (m.phase === 'bidding' ? 'Bidding 16–28' : m.phase === 'chooseTrump' ? 'Bidder choosing trump' : '');
}

function nameOf(m, seat) {
  const s = m.seats[seat];
  return seat === m.you ? 'You' : (s ? s.name : SEATNAME(seat));
}

function renderTrick(m) {
  const area = $('trick-area');
  area.innerHTML = '';
  for (let seat = 0; seat < 4; seat++) {
    const slot = (seat - m.you + 4) % 4; // rotate so YOU are bottom
    const div = document.createElement('div');
    div.className = 'trick-slot seat-' + slot;
    const label = document.createElement('div');
    label.className = 'slot-label' + (m.turn === seat && m.phase === 'play' && !m.resolving ? ' active' : '');
    const s = m.seats[seat];
    label.textContent = (seat === m.you ? 'You' : (s ? s.name : SEATNAME(seat))) + (seat % 2 === 0 ? ' · A' : ' · B');
    div.appendChild(label);
    const played = (m.plays || []).find((p) => p.seat === seat);
    if (played) div.appendChild(cardEl(played.card));
    else { const e = document.createElement('div'); e.className = 'card empty'; div.appendChild(e); }
    area.appendChild(div);
  }
}

function renderGameOver(m) {
  const team = m.gameWinner;
  const iWon = (m.you % 2) === team;
  iWon ? Sound.win() : Sound.lose();
  $('table-message').textContent = (team === 0 ? 'Team A' : 'Team B') + ' wins ' +
    m.matchPoints[0] + '–' + m.matchPoints[1] + (iWon ? ' — you won! 🎉' : '');
  const ctr = $('controls');
  ctr.innerHTML = '';
  if (me.host) {
    const re = document.createElement('button'); re.className = 'glow-btn'; re.textContent = 'Rematch';
    re.onclick = () => { Sound.init(); sendRaw({ t: 'rematch' }); };
    ctr.appendChild(re);
  } else {
    const wait = document.createElement('div'); wait.className = 'hint'; wait.textContent = 'Host can start a rematch…';
    ctr.appendChild(wait);
  }
  const btn = document.createElement('button'); btn.className = 'secondary'; btn.textContent = 'Back to home';
  btn.onclick = () => { sendRaw({ t: 'leave' }); localStorage.removeItem(CODE_KEY); _lastNarr = ''; $('game-log').innerHTML = ''; show('entry-screen'); };
  ctr.appendChild(btn);
}

// ---------- Learn 29: build the card examples from the engine's own constants,
// so the tutorial can never drift from the actual rules ----------
function buildLearn() {
  const rankRow = $('learn-rank'), pointRow = $('learn-points');
  if (!rankRow || rankRow.childElementCount) return; // build once
  // strongest → weakest, straight from TRICK_STRENGTH
  const byStrength = RANKS.slice().sort((a, b) => TRICK_STRENGTH[b] - TRICK_STRENGTH[a]);
  const suits = ['spades', 'hearts', 'diamonds', 'clubs'];
  byStrength.forEach((rank, i) => {
    const wrap = document.createElement('div');
    wrap.className = 'learn-card';
    wrap.appendChild(cardEl({ rank, suit: suits[i % 4], id: rank }));
    const cap = document.createElement('span');
    cap.className = 'cap';
    cap.textContent = i === 0 ? 'highest' : (i === byStrength.length - 1 ? 'lowest' : '');
    wrap.appendChild(cap);
    rankRow.appendChild(wrap);
  });
  // point-scoring ranks only
  RANKS.filter((r) => CARD_POINTS[r] > 0)
    .sort((a, b) => CARD_POINTS[b] - CARD_POINTS[a])
    .forEach((rank, i) => {
      const wrap = document.createElement('div');
      wrap.className = 'learn-card';
      wrap.appendChild(cardEl({ rank, suit: suits[i % 4], id: 'p' + rank }));
      const cap = document.createElement('span');
      cap.className = 'cap';
      cap.textContent = CARD_POINTS[rank] + (CARD_POINTS[rank] === 1 ? ' point' : ' points');
      wrap.appendChild(cap);
      pointRow.appendChild(wrap);
    });
}

// ---------- settings ----------
const PREFS_KEY = 'twentynine-prefs';
function loadPrefs() {
  try { return JSON.parse(localStorage.getItem(PREFS_KEY)) || {}; } catch (e) { return {}; }
}
function savePrefs(p) { try { localStorage.setItem(PREFS_KEY, JSON.stringify(p)); } catch (e) {} }
function applyPrefs(p) {
  document.body.classList.toggle('cb', !!p.colorblind);
  document.body.classList.toggle('big-cards', !!p.bigCards);
  document.body.classList.toggle('reduce-motion', !!p.reduceMotion);
  Sound.setEnabled(p.sound !== false);
  const mb = $('mute-btn');
  if (mb) mb.innerHTML = (p.sound === false) ? '🔇' : '🔊';
}
function initSettings() {
  const p = loadPrefs();
  if (p.sound === undefined) p.sound = localStorage.getItem('twentynine-muted') !== '1';
  applyPrefs(p);
  const bind = (id, key) => {
    const el = $(id);
    if (!el) return;
    el.checked = key === 'sound' ? p.sound !== false : !!p[key];
    el.onchange = () => {
      p[key] = el.checked;
      savePrefs(p); applyPrefs(p);
      if (key === 'sound') { Sound.init(); localStorage.setItem('twentynine-muted', el.checked ? '0' : '1'); }
    };
  };
  bind('set-sound', 'sound');
  bind('set-motion', 'reduceMotion');
  bind('set-colorblind', 'colorblind');
  bind('set-bigcards', 'bigCards');
  const so = $('set-signout');
  if (so) so.onclick = () => { localStorage.removeItem(TOKEN_KEY); localStorage.removeItem(CODE_KEY); location.reload(); };
  // the topbar speaker button and the Settings checkbox stay in sync
  const mb = $('mute-btn');
  if (mb) mb.onclick = () => {
    Sound.init();
    p.sound = !(p.sound !== false);
    savePrefs(p); applyPrefs(p);
    const c = $('set-sound'); if (c) c.checked = p.sound !== false;
    localStorage.setItem('twentynine-muted', p.sound ? '0' : '1');
  };
}

// ---------- mute ----------
(function initMute() {
  const muted = localStorage.getItem('twentynine-muted') === '1';
  Sound.setEnabled(!muted);
  const btn = $('mute-btn');
  btn.innerHTML = muted ? '🔇' : '🔊';
  btn.onclick = () => {
    Sound.init();
    const nowMuted = Sound.enabled;
    Sound.setEnabled(!Sound.enabled);
    btn.innerHTML = nowMuted ? '🔇' : '🔊';
    localStorage.setItem('twentynine-muted', nowMuted ? '1' : '0');
  };
})();

initSettings();
connect();
