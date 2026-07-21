process.env.USERS_DB = ':memory:';
const https = require('https');
const { server, users } = require('./server.js');
const WS = require('ws');
const API_KEY = 'AIzaSyA8fi9yuX5Dyb-1IvMhgJ_34wDb4kmwhlk';
const errs = [];
const tick = (ms) => new Promise((r) => setTimeout(r, ms));
function post(url, body) {
  return new Promise((res, rej) => {
    const data = JSON.stringify(body); const u = new URL(url);
    const r = https.request({ hostname: u.hostname, path: u.pathname + u.search, method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } },
      (resp) => { let d = ''; resp.on('data', (c) => d += c); resp.on('end', () => res(JSON.parse(d))); });
    r.on('error', rej); r.write(data); r.end();
  });
}
async function freshToken() {
  const email = 'e2e' + Date.now() + Math.floor(Math.random() * 999) + '@test.com';
  const r = await post('https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=' + API_KEY, { email, password: 'e2e12345', returnSecureToken: true });
  return { token: r.idToken, uid: r.localId, email };
}

server.listen(0, async () => {
  const url = 'ws://localhost:' + server.address().port;

  // 1) sign in with a real Firebase token -> creates a game account keyed by UID
  const A = await freshToken();
  let acc1 = await new Promise((res) => {
    const ws = new WS(url);
    ws.on('open', () => ws.send(JSON.stringify({ t: 'firebaseAuth', token: A.token })));
    ws.on('message', (d) => { const m = JSON.parse(d); if (m.t === 'authOk' || m.t === 'authErr') { ws.close(); res(m); } });
  });
  if (acc1.t !== 'authOk') errs.push('firebase sign-in failed: ' + acc1.msg);
  else console.log('  signed in via Firebase ->', acc1.user, '| trophies', acc1.stats.rating);

  // 2) same token again -> SAME account (not a duplicate)
  const B = await post('https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=' + API_KEY, { email: A.email, password: 'e2e12345', returnSecureToken: true });
  const acc2 = await new Promise((res) => {
    const ws = new WS(url);
    ws.on('open', () => ws.send(JSON.stringify({ t: 'firebaseAuth', token: B.idToken })));
    ws.on('message', (d) => { const m = JSON.parse(d); if (m.t === 'authOk') { ws.close(); res(m); } });
  });
  if (acc2.user !== acc1.user) errs.push('same Firebase user got a different account: ' + acc1.user + ' vs ' + acc2.user);
  else console.log('  re-login same UID -> same account (' + acc2.user + ') ✓');
  const humanAccounts = Object.values(users).filter((u) => u.firebaseUid).length;
  if (humanAccounts !== 1) errs.push('expected 1 firebase account, have ' + humanAccounts);

  // 3) a fake token is rejected
  const bad = await new Promise((res) => {
    const ws = new WS(url);
    ws.on('open', () => ws.send(JSON.stringify({ t: 'firebaseAuth', token: 'not.a.real.token' })));
    ws.on('message', (d) => { const m = JSON.parse(d); if (m.t === 'authOk' || m.t === 'authErr') { ws.close(); res(m); } });
  });
  if (bad.t !== 'authErr') errs.push('fake token was NOT rejected');
  else console.log('  fake token rejected ->', JSON.stringify(bad.msg));

  // 4) guest -> firebase upgrade keeps the guest's session progress
  const C = await freshToken();
  const upg = await new Promise((res) => {
    const ws = new WS(url); let coins = 0;
    ws.on('open', () => ws.send(JSON.stringify({ t: 'guest' })));
    ws.on('message', (d) => {
      const m = JSON.parse(d);
      if (m.t === 'authOk' && m.guest) { coins = m.stats.coins; ws.send(JSON.stringify({ t: 'claimDaily' })); }
      else if (m.t === 'daily') { coins = m.stats.coins; ws.send(JSON.stringify({ t: 'firebaseAuth', token: C.token })); }
      else if (m.t === 'authOk' && !m.guest) { ws.close(); res({ before: coins, after: m.stats.coins, name: m.user }); }
    });
  });
  if (upg.after !== upg.before) errs.push('guest progress lost on firebase upgrade: ' + upg.before + ' -> ' + upg.after);
  else console.log('  guest -> Firebase account kept ' + upg.after + ' coins as ' + upg.name + ' ✓');

  if (errs.length) { console.log('ERRORS:\n' + errs.join('\n')); process.exit(1); }
  console.log('FIREBASE OK: real tokens verified (projectId only), one account per UID, fakes rejected, guest progress preserved on upgrade');
  process.exit(0);
});
