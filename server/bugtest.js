process.env.USERS_DB=':memory:';
process.env.BOT_MS='2'; process.env.RESOLVE_MS='2'; process.env.NEXT_MS='2'; process.env.ABANDON_MS='400';
const { server, rooms } = require('./server.js');
const WS = require('ws');
const errs=[]; const tick=ms=>new Promise(r=>setTimeout(r,ms));
setTimeout(()=>{ console.log('TIMEOUT\n'+errs.join('\n')); process.exit(1); }, 25000).unref();

function client(first){
  const c={msgs:[],code:null,err:null,chats:0};
  c.ws=new WS('ws://localhost:'+server.address().port);
  c.ws.on('open',()=>{ if(first) c.ws.send(JSON.stringify(first)); });
  c.ws.on('message',d=>{ const m=JSON.parse(d); c.msgs.push(m);
    if(m.t==='joined') c.code=m.code;
    if(m.t==='chat') c.chats++;
    if(m.t==='error'||m.t==='authErr') c.err=m.msg; });
  return c;
}
const waitFor=async(c,pred,ms=5000)=>{ const t=Date.now(); while(Date.now()-t<ms){ if(pred(c)) return true; await tick(15);} return false; };
const authed=c=>c.msgs.some(m=>m.t==='authOk');

server.listen(0, async () => {
  // BUG 1 — host drops mid-game, host must move to a connected human
  const A=client({t:'guest'}), B=client({t:'guest'});
  if(!await waitFor(A,authed) || !await waitFor(B,authed)) { console.log('auth failed'); process.exit(1); }
  A.ws.send(JSON.stringify({t:'createRoom'})); await waitFor(A,c=>c.code);
  const code=A.code;
  B.ws.send(JSON.stringify({t:'joinRoom',code})); await waitFor(B,c=>c.code);
  A.ws.send(JSON.stringify({t:'fillBots'})); await tick(80);
  A.ws.send(JSON.stringify({t:'start'})); await tick(150);
  if(rooms.get(code).hostSeat!==0) errs.push('host should start at seat 0');
  A.ws.close(); await tick(250);
  if(!rooms.has(code)) errs.push('room died though B was still connected');
  else if(rooms.get(code).hostSeat!==1) errs.push('BUG1 host not reassigned (hostSeat='+rooms.get(code).hostSeat+')');
  const hostAfter = rooms.has(code)? rooms.get(code).hostSeat : '(gone)';

  // BUG 2 — creating a second room must not orphan the first
  const C=client({t:'guest'}); await waitFor(C,authed);
  C.ws.send(JSON.stringify({t:'createRoom'})); await waitFor(C,c=>c.code); const first=C.code;
  C.code=null;
  C.ws.send(JSON.stringify({t:'createRoom'})); await waitFor(C,c=>c.code); const second=C.code;
  if(first===second) errs.push('second createRoom returned same room');
  if(rooms.has(first)) errs.push('BUG2 first room orphaned');

  // BUG 3 — chat flood throttled
  const D=client({t:'guest'}); await waitFor(D,authed);
  D.ws.send(JSON.stringify({t:'createRoom'})); await waitFor(D,c=>c.code);
  for(let i=0;i<30;i++) D.ws.send(JSON.stringify({t:'chat',text:'spam'+i}));
  await tick(300);
  if(D.chats>12) errs.push('BUG3 chat not throttled ('+D.chats+'/30)');

  // BUG 4 — Guest- prefix reserved
  const E=client({t:'register',user:'Guest-FAKE',pass:'pw12345'});
  await waitFor(E,c=>c.err);
  if(!E.err || !/reserved/i.test(E.err)) errs.push('BUG4 Guest- not reserved (err='+E.err+')');

  console.log('hostSeat after host drop:', hostAfter, '| first room orphaned:', rooms.has(first),
    '| chat delivered:', D.chats+'/30', '| register err:', E.err);
  if(errs.length){ console.log('ERRORS:\n'+errs.join('\n')); process.exit(1); }
  console.log('ALL 4 BUGS FIXED: host reassigned, no orphan room, chat throttled, Guest- reserved');
  process.exit(0);
});
