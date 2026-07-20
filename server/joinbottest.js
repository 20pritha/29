process.env.USERS_DB = ':memory:';
const { server, rooms } = require('./server.js');
const WS = require('ws');
const tick = (ms) => new Promise((r) => setTimeout(r, ms));
const errs = [];

function C() {
  const c = { msgs: [], code: null, seat: null, lobby: null, err: null };
  c.ws = new WS('ws://localhost:' + server.address().port);
  c.ws.on('open', () => c.ws.send(JSON.stringify({ t: 'guest' })));
  c.ws.on('message', (d) => {
    const m = JSON.parse(d);
    c.msgs.push(m);
    if (m.t === 'joined') { c.code = m.code; c.seat = m.seat; }
    if (m.t === 'room') c.lobby = m;
    if (m.t === 'error') c.err = m.msg;
  });
  return c;
}
const wait = async (c, p, ms = 4000) => {
  const t = Date.now();
  while (Date.now() - t < ms) { if (p(c)) return true; await tick(20); }
  return false;
};

server.listen(0, async () => {
  const A = C();
  await wait(A, (c) => c.msgs.some((m) => m.t === 'authOk'));
  A.ws.send(JSON.stringify({ t: 'createRoom' }));
  await wait(A, (c) => c.code);
  console.log('A created room', A.code, '| seat', A.seat);

  // --- JOIN BY CODE ---
  const B = C();
  await wait(B, (c) => c.msgs.some((m) => m.t === 'authOk'));
  B.ws.send(JSON.stringify({ t: 'joinRoom', code: A.code }));
  const joined = await wait(B, (c) => c.code);
  if (!joined) errs.push('JOIN: B never received joined (err=' + B.err + ')');
  else {
    console.log('B joined room', B.code, '| seat', B.seat);
    if (B.code !== A.code) errs.push('JOIN: B put in wrong room ' + B.code + ' vs ' + A.code);
    const r = rooms.get(A.code);
    const humans = r.seats.filter((s) => s && !s.bot).length;
    if (humans !== 2) errs.push('JOIN: room has ' + humans + ' humans, expected 2');
    await tick(150);
    const filled = A.lobby && A.lobby.filled;
    console.log('  server filled:', filled, '| seats:', r.seats.map((s) => (s ? (s.bot ? 'bot' : s.name) : 'empty')).join(', '));
    if (filled !== 2) errs.push('JOIN: host lobby shows filled=' + filled + ', expected 2');
  }

  // --- ADD then REMOVE BOT ---
  A.ws.send(JSON.stringify({ t: 'fillBots' }));
  await tick(200);
  let r = rooms.get(A.code);
  const botsBefore = r.seats.filter((s) => s && s.bot).length;
  const botSeat = r.seats.findIndex((s) => s && s.bot);
  console.log('after fillBots: bots =', botsBefore, '| removing seat', botSeat);
  A.ws.send(JSON.stringify({ t: 'removeSeat', seat: botSeat }));
  await tick(250);
  r = rooms.get(A.code);
  const botsAfter = r.seats.filter((s) => s && s.bot).length;
  console.log('after removeSeat: bots =', botsAfter, '| seats:', r.seats.map((s) => (s ? (s.bot ? 'bot' : s.name) : 'empty')).join(', '));
  if (botsAfter !== botsBefore - 1) errs.push('REMOVE BOT failed — bots ' + botsBefore + ' -> ' + botsAfter);

  if (errs.length) { console.log('ERRORS:\n' + errs.join('\n')); process.exit(1); }
  console.log('JOIN + REMOVE BOT OK');
  process.exit(0);
});
