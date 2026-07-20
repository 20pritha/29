// UI layer for Twenty-Nine.
// Modes:
//   'solo'    — you are Player 1; seats 2/3/4 are bots. No pass-gate.
//   'hotseat' — 4 humans, one device. Pass-device gate hides hands between turns.

const SEAT_NAMES = ['Player 1', 'Player 2', 'Player 3', 'Player 4'];
const TEAM_NAMES = ['Team A', 'Team B'];

let gameMode = 'solo';
const HUMAN_SEAT = 0; // in solo, the human always sits here

const el = {
  pts0: document.getElementById('pts-0'),
  pts1: document.getElementById('pts-1'),
  roundInfo: document.getElementById('round-info'),
  bidInfo: document.getElementById('bid-info'),
  trumpInfo: document.getElementById('trump-info'),
  narration: document.getElementById('narration'),
  trickArea: document.getElementById('trick-area'),
  tableMsg: document.getElementById('table-message'),
  playerLabel: document.getElementById('player-label'),
  hand: document.getElementById('hand'),
  controls: document.getElementById('controls'),
  overlay: document.getElementById('overlay'),
  overlayTitle: document.getElementById('overlay-title'),
  overlayBody: document.getElementById('overlay-body'),
  overlayBtn: document.getElementById('overlay-btn'),
};

let viewUnlocked = false; // hotseat pass-gate state
let lastTurnSeat = null;
let lastPhase = null;
let botTimer = null;

function isBot(seat) {
  return gameMode === 'solo' && seat !== HUMAN_SEAT;
}

// ---------- persistence ----------
const SAVE_KEY = 'twentynine-save-v1';
const MUTE_KEY = 'twentynine-muted';

function ls() {
  // Accessing localStorage can throw (opaque origin, private mode, blocked).
  try { return (typeof window !== 'undefined' && window.localStorage) || null; }
  catch (e) { return null; }
}

function persist() {
  const store = ls();
  if (!store || Game._pendingResolve) return;
  if (!['bidding', 'chooseTrump', 'play', 'roundEnd'].includes(Game.phase)) return;
  try {
    store.setItem(SAVE_KEY, JSON.stringify({ mode: gameMode, state: Game.snapshot() }));
  } catch (e) { /* quota / unavailable */ }
}
function loadSave() {
  const store = ls();
  if (!store) return null;
  try { const s = store.getItem(SAVE_KEY); return s ? JSON.parse(s) : null; }
  catch (e) { return null; }
}
function clearSave() {
  const store = ls();
  if (store) try { store.removeItem(SAVE_KEY); } catch (e) {}
}

// ---------- mute ----------
function initMute() {
  const store = ls();
  const muted = store && store.getItem(MUTE_KEY) === '1';
  Sound.setEnabled(!muted);
  const btn = document.getElementById('mute-btn');
  if (btn) {
    btn.classList.toggle('muted', !!muted);
    btn.innerHTML = muted ? '&#128263;' : '&#128266;';
    btn.onclick = () => {
      Sound.init();
      const nowMuted = Sound.enabled; // about to flip
      Sound.setEnabled(!Sound.enabled);
      btn.classList.toggle('muted', nowMuted);
      btn.innerHTML = nowMuted ? '&#128263;' : '&#128266;';
      if (store) try { store.setItem(MUTE_KEY, nowMuted ? '1' : '0'); } catch (e) {}
    };
  }
}

// ---------- small builders ----------
function cardEl(card, { playable = false, onClick = null, faceDown = false } = {}) {
  const d = document.createElement('div');
  if (faceDown) { d.className = 'card back'; return d; }
  d.className = 'card ' + SUIT_COLOR[card.suit];
  d.innerHTML =
    '<span class="rank">' + card.rank + '</span>' +
    '<span class="suit">' + SUIT_SYMBOL[card.suit] + '</span>';
  if (playable) {
    d.classList.add('playable');
    d.addEventListener('click', onClick);
  } else {
    d.classList.add('disabled');
  }
  return d;
}

function showOverlay(title, bodyNode, btnText, onBtn) {
  el.overlayTitle.textContent = title;
  el.overlayBody.innerHTML = '';
  if (bodyNode) el.overlayBody.appendChild(bodyNode);
  if (btnText) {
    el.overlayBtn.style.display = '';
    el.overlayBtn.textContent = btnText;
    el.overlayBtn.onclick = onBtn;
  } else {
    el.overlayBtn.style.display = 'none';
  }
  el.overlay.classList.remove('hidden');
}
function hideOverlay() { el.overlay.classList.add('hidden'); }

// ---------- start menu ----------
function showMenu() {
  const body = document.createElement('div');
  body.className = 'menu-body';

  const saved = loadSave();
  if (saved && saved.state && saved.state.phase && saved.state.phase !== 'gameOver') {
    const resume = document.createElement('button');
    resume.className = 'menu-btn resume';
    resume.textContent = 'Resume game (' + (saved.mode === 'solo' ? 'Solo' : 'Hot-seat') +
      ', match ' + saved.state.matchPoints.join('–') + ')';
    resume.onclick = () => {
      Sound.init();
      gameMode = saved.mode;
      viewUnlocked = false;
      hideOverlay();
      Game.loadSnapshot(saved.state);
    };
    body.appendChild(resume);
  }

  const solo = document.createElement('button');
  solo.className = 'menu-btn';
  solo.textContent = 'Solo — you vs 3 bots';
  solo.onclick = () => { Sound.init(); gameMode = 'solo'; clearSave(); hideOverlay(); Game.newGame(); };
  const hot = document.createElement('button');
  hot.className = 'menu-btn';
  hot.textContent = 'Hot-seat — 4 players, one device';
  hot.onclick = () => { Sound.init(); gameMode = 'hotseat'; clearSave(); hideOverlay(); Game.newGame(); };
  body.appendChild(solo);
  body.appendChild(hot);
  showOverlay('Twenty–Nine', body, null, null);
}

// ---------- render ----------
function render() {
  const G = Game;

  el.pts0.textContent = G.matchPoints[0];
  el.pts1.textContent = G.matchPoints[1];
  el.roundInfo.textContent = 'Dealer: ' + SEAT_NAMES[G.dealer];
  el.bidInfo.textContent =
    G.highBidder !== null ? 'Bid: ' + G.highBid + ' by ' + SEAT_NAMES[G.highBidder] : 'Bid: —';
  el.trumpInfo.textContent = G.trumpRevealed
    ? 'Trump: ' + SUIT_SYMBOL[G.trumpSuit]
    : (G.trumpSuit ? 'Trump: hidden' : 'Trump: —');
  el.narration.textContent = G.narration || '';

  persist();
  renderTrick();

  if (G._pendingResolve) {
    hideOverlay();
    el.hand.innerHTML = '';
    el.controls.innerHTML = '';
    el.playerLabel.textContent = 'Trick complete';
    return;
  }
  if (G.phase === 'gameOver') return renderGameOver();
  if (G.phase === 'roundEnd') return renderRoundEnd();
  if (!['bidding', 'chooseTrump', 'play'].includes(G.phase)) return;

  if (gameMode === 'hotseat') {
    if (G.turn !== lastTurnSeat || G.phase !== lastPhase) {
      viewUnlocked = false;
      lastTurnSeat = G.turn;
      lastPhase = G.phase;
    }
    if (!viewUnlocked) { renderPassGate(); return; }
  }
  hideOverlay();

  const viewer = gameMode === 'solo' ? HUMAN_SEAT : G.turn;
  const myTurn = G.turn === viewer;

  if (G.phase === 'bidding') renderBidding(viewer, myTurn);
  else if (G.phase === 'chooseTrump') renderChooseTrump(viewer, myTurn);
  else if (G.phase === 'play') renderPlay(viewer, myTurn);

  scheduleBot();
}

function renderPassGate() {
  el.hand.innerHTML = '';
  el.controls.innerHTML = '';
  el.playerLabel.textContent = '';
  el.tableMsg.textContent = '';
  const body = document.createElement('p');
  const what = Game.phase === 'bidding' ? 'to bid'
    : Game.phase === 'chooseTrump' ? 'to choose trump' : 'to play';
  body.textContent = 'Hand hidden. Pass device to ' + SEAT_NAMES[Game.turn] + ' ' + what + ', then tap.';
  showOverlay('Pass to ' + SEAT_NAMES[Game.turn], body, "I'm " + SEAT_NAMES[Game.turn], () => {
    viewUnlocked = true; hideOverlay(); render();
  });
}

function renderTrick() {
  el.trickArea.innerHTML = '';
  for (let seat = 0; seat < 4; seat++) {
    const slot = document.createElement('div');
    slot.className = 'trick-slot seat-' + seat;
    const label = document.createElement('div');
    label.className = 'slot-label' +
      (Game.turn === seat && Game.phase === 'play' && !Game._pendingResolve ? ' active' : '');
    label.textContent = SEAT_NAMES[seat] + (Game.team(seat) === 0 ? ' · A' : ' · B') +
      (isBot(seat) ? ' 🤖' : '');
    slot.appendChild(label);
    const played = Game.plays.find((p) => p.seat === seat);
    if (played) slot.appendChild(cardEl(played.card));
    else { const e = document.createElement('div'); e.className = 'card empty'; slot.appendChild(e); }
    el.trickArea.appendChild(slot);
  }
}

function renderHand(seat, { playable = false } = {}) {
  el.hand.innerHTML = '';
  const legal = playable && Game.phase === 'play'
    ? Game.legalCards(seat).map((c) => c.id) : [];
  Game.players[seat].hand.forEach((c, i) => {
    let node;
    if (playable && Game.phase === 'play') {
      const ok = legal.includes(c.id);
      node = cardEl(c, { playable: ok, onClick: ok ? () => onHumanPlay(c.id) : null });
    } else {
      node = cardEl(c, { playable: false });
    }
    node.style.animationDelay = (i * 0.03) + 's'; // staggered deal-in
    el.hand.appendChild(node);
  });
}

function waitingLabel() {
  return SEAT_NAMES[Game.turn] + (isBot(Game.turn) ? ' 🤖 thinking…' : ' …');
}

function renderBidding(viewer, myTurn) {
  renderHand(viewer);
  el.playerLabel.textContent = myTurn
    ? SEAT_NAMES[viewer] + ' — your bid'
    : 'Your cards · ' + waitingLabel();
  el.controls.innerHTML = '';
  el.tableMsg.textContent = 'Bidding 16–28. Highest bidder names trump.';
  if (!myTurn) return;

  const G = Game;
  const wrap = document.createElement('div');
  wrap.className = 'bid-controls';
  const minNext = Math.max(MIN_BID, G.highBid + 1);
  const hint = document.createElement('div');
  hint.className = 'bid-hint';
  hint.textContent = G.highBidder !== null
    ? 'High bid ' + G.highBid + '. Bid ' + minNext + '+ or pass.'
    : 'Open at ' + MIN_BID + '+ or pass.';
  wrap.appendChild(hint);
  const row = document.createElement('div');
  row.className = 'bid-row';
  for (let b = minNext; b <= MAX_BID; b++) {
    const btn = document.createElement('button');
    btn.className = 'bid-btn';
    btn.textContent = b;
    btn.onclick = () => { Sound.bid(); G.placeBid(viewer, b); };
    row.appendChild(btn);
  }
  wrap.appendChild(row);
  const pass = document.createElement('button');
  pass.className = 'pass-btn';
  pass.textContent = 'Pass';
  pass.onclick = () => { Sound.bid(); G.passBid(viewer); };
  wrap.appendChild(pass);
  el.controls.appendChild(wrap);
}

function renderChooseTrump(viewer, myTurn) {
  renderHand(viewer);
  el.controls.innerHTML = '';
  if (!myTurn) {
    el.playerLabel.textContent = 'Your cards · ' + waitingLabel() + ' (choosing trump)';
    el.tableMsg.textContent = SEAT_NAMES[Game.turn] + ' won the bid at ' + Game.highBid + '.';
    return;
  }
  el.playerLabel.textContent = SEAT_NAMES[viewer] + ' won at ' + Game.highBid + ' — pick trump (secret)';
  el.tableMsg.textContent = 'Choose trump from your cards. Stays hidden until revealed.';
  const row = document.createElement('div');
  row.className = 'trump-row';
  for (const suit of Game.trumpChoices()) {
    const btn = document.createElement('button');
    btn.className = 'trump-btn ' + SUIT_COLOR[suit];
    btn.innerHTML = SUIT_SYMBOL[suit];
    btn.onclick = () => Game.chooseTrump(suit);
    row.appendChild(btn);
  }
  el.controls.appendChild(row);
}

function renderPlay(viewer, myTurn) {
  const G = Game;
  renderHand(viewer, { playable: myTurn });
  el.controls.innerHTML = '';
  el.playerLabel.textContent = myTurn
    ? SEAT_NAMES[viewer] + ' — trick ' + (G.trickCount + 1) + '/8'
    : 'Your cards · ' + waitingLabel() + ' (trick ' + (G.trickCount + 1) + '/8)';

  if (myTurn && G.canRevealTrump(viewer)) {
    const btn = document.createElement('button');
    btn.className = 'reveal-btn';
    btn.textContent = 'Reveal Trump';
    btn.onclick = () => { Sound.reveal(); G.revealTrump(viewer); };
    el.controls.appendChild(btn);
  }
  if (myTurn) {
    el.tableMsg.textContent = G.ledSuit
      ? 'Led: ' + SUIT_SYMBOL[G.ledSuit] + (G.mustPlayTrump ? ' — you revealed, must play trump' : '')
      : 'You lead. Play any card.';
  } else {
    el.tableMsg.textContent = G.ledSuit ? 'Led: ' + SUIT_SYMBOL[G.ledSuit] : '';
  }
}

// ---------- actions ----------
function onHumanPlay(cardId) {
  Sound.card();
  Game.playCard(Game.turn, cardId);
  if (Game._pendingResolve) scheduleResolve();
}

function scheduleResolve() {
  const w = Game.trickWinner();
  setTimeout(() => {
    el.tableMsg.textContent = SEAT_NAMES[w] + ' wins the trick';
    Sound.win();
    setTimeout(() => Game.resolveTrick(), 850);
  }, 600);
}

function scheduleBot() {
  if (botTimer) return;
  const G = Game;
  if (G._pendingResolve) return;
  if (!isBot(G.turn)) return;
  if (!['bidding', 'chooseTrump', 'play'].includes(G.phase)) return;
  botTimer = setTimeout(() => { botTimer = null; botAct(); }, 700);
}

function botAct() {
  const G = Game;
  const seat = G.turn;
  if (!isBot(seat) || G._pendingResolve) return;
  if (G.phase === 'bidding') {
    const d = AI.bid(seat);
    Sound.bid();
    if (d.action === 'bid') G.placeBid(seat, d.amount); else G.passBid(seat);
  } else if (G.phase === 'chooseTrump') {
    G.chooseTrump(AI.chooseTrump(seat));
  } else if (G.phase === 'play') {
    const m = AI.play(seat);
    if (m.reveal) { Sound.reveal(); G.revealTrump(seat); }
    Sound.card();
    G.playCard(seat, m.cardId);
    if (G._pendingResolve) scheduleResolve();
  }
}

// ---------- results ----------
let roundEndSounded = false;
function renderRoundEnd() {
  const r = Game.lastResult;
  if (!roundEndSounded) {
    roundEndSounded = true;
    if (gameMode === 'solo') (r.winnerTeam === 0 ? Sound.win() : Sound.lose());
    else Sound.win();
  }
  const body = document.createElement('div');
  body.className = 'result-body';
  body.innerHTML =
    '<p>' + SEAT_NAMES[r.bidder] + ' (' + TEAM_NAMES[r.bidTeam] + ') bid <b>' + r.bid +
    '</b>, scored <b>' + r.bidTeamPoints + '</b> — ' +
    (r.made ? '<span class="made">MADE</span>' : '<span class="set">SET</span>') + '.</p>' +
    '<p>Card points — ' + TEAM_NAMES[0] + ': ' + r.cardPoints[0] + ' · ' +
    TEAM_NAMES[1] + ': ' + r.cardPoints[1] + ' (trump ' + SUIT_SYMBOL[r.trumpSuit] + ')</p>' +
    '<p><b>' + TEAM_NAMES[r.winnerTeam] + '</b> takes the hand. Match ' +
    Game.matchPoints[0] + ' – ' + Game.matchPoints[1] + '.</p>';
  showOverlay('Hand over', body, 'Next hand', () => {
    viewUnlocked = false; roundEndSounded = false; Game.nextRound();
  });
}

let gameOverSounded = false;
function renderGameOver() {
  clearSave();
  if (!gameOverSounded) {
    gameOverSounded = true;
    if (gameMode === 'solo') (Game.gameWinner === 0 ? Sound.win() : Sound.lose());
    else Sound.win();
  }
  const body = document.createElement('div');
  body.innerHTML = '<p class="win-line">' + TEAM_NAMES[Game.gameWinner] + ' wins the match ' +
    Game.matchPoints[0] + ' – ' + Game.matchPoints[1] + '!</p>';
  showOverlay('Game over', body, 'New game', () => {
    viewUnlocked = false; gameOverSounded = false; roundEndSounded = false; showMenu();
  });
}

Game.onChange(render);
initMute();
showMenu();
