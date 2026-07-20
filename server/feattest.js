process.env.USERS_DB=':memory:';
// Integration test for ranked (Elo) + chat + rematch + reconnect.
process.env.BOT_MS='2'; process.env.RESOLVE_MS='2'; process.env.NEXT_MS='2';
const { server } = require('./server.js');
const WebSocket = require('ws');
const errs=[]; const assert=(c,m)=>{ if(!c) errs.push(m); };
const url=()=>'ws://localhost:'+server.address().port;

function mkClient(name){
  return { name, ws:null, token:null, seat:null, code:null, state:null, stats:null,
           statsMsgs:[], chats:[], connected:false, drive:true };
}
function attach(c, {onReady}={}){
  c.ws = new WebSocket(url());
  c.connected=true;
  c.ws.on('open', ()=>{
    if(c.token) c.ws.send(JSON.stringify({t:'auth', token:c.token}));
    else c.ws.send(JSON.stringify({t:'register', user:c.name, pass:'pw123'}));
  });
  c.ws.on('message',(d)=>{
    const m=JSON.parse(d.toString());
    if(m.t==='authErr'){ c.ws.send(JSON.stringify({t:'login',user:c.name,pass:'pw123'})); return; }
    if(m.t==='authOk'){ c.token=m.token; c.stats=m.stats; onReady&&onReady(); return; }
    if(m.t==='joined'){ c.code=m.code; c.seat=m.seat; return; }
    if(m.t==='room'){ c.lobby=m; return; }
    if(m.t==='state'){ c.state=m; if(c.drive) driveState(c,m); return; }
    if(m.t==='stats'){ c.statsMsgs.push(m); c.stats=m.stats; return; }
    if(m.t==='chat'){ c.chats.push(m); return; }
    if(m.t==='noRoom'){ c.noRoom=true; return; }
  });
  c.ws.on('close', ()=>{ c.connected=false; });
}
function driveState(c,m){
  if(m.you!==m.turn || m.resolving) return;
  if(m.phase==='bidding'&&m.canBid) c.ws.send(JSON.stringify({t:'action',action:'pass'}));
  else if(m.phase==='chooseTrump'&&m.trumpChoices) c.ws.send(JSON.stringify({t:'action',action:'trump',suit:m.trumpChoices[0]}));
  else if(m.phase==='play'&&m.legal) c.ws.send(JSON.stringify({t:'action',action:'play',cardId:m.legal[0]}));
}
const tick=ms=>new Promise(r=>setTimeout(r,ms));

server.listen(0, async ()=>{
  const A=mkClient('Host'+Date.now()%100000), B=mkClient('Guest'+Date.now()%100000);

  await new Promise(res=> attach(A,{onReady:res}));
  A.ws.send(JSON.stringify({t:'createRoom'}));
  await tick(60);
  await new Promise(res=> attach(B,{onReady:res}));
  B.ws.send(JSON.stringify({t:'joinRoom', code:A.code}));
  await tick(80);
  assert(B.seat===1, 'B not seated at 1: '+B.seat);
  const ratingBeforeA=A.stats.rating, ratingBeforeB=B.stats.rating;

  A.ws.send(JSON.stringify({t:'fillBots'}));
  await tick(60);
  A.ws.send(JSON.stringify({t:'start'}));
  await tick(80);

  // chat check
  A.ws.send(JSON.stringify({t:'chat', text:'gl hf'}));
  await tick(60);
  assert(B.chats.some(c=>c.from===A.name && c.text==='gl hf'), 'B did not receive chat from A');

  // reconnect check: once we reach a few tricks, drop B, let stand-in play, then rejoin
  let dropped=false, rejoined=false;
  const t0=Date.now();
  while(Date.now()-t0 < 15000){
    if(A.state && A.state.gameWinner!=null) break;
    if(!dropped && A.state && A.state.trickCount>=2 && A.state.phase==='play'){
      dropped=true;
      B.drive=false; B.ws.close();          // simulate B dropping
      await tick(120);                       // stand-in bot should keep game moving
      // verify server sees B disconnected
      const seatB = A.state.seats[1];
      assert(seatB && !seatB.connected, 'B seat still shows connected after drop');
      // reconnect B with token + rejoin
      B.drive=true;
      await new Promise(res=> attach(B,{onReady:()=>{ B.ws.send(JSON.stringify({t:'rejoin', code:A.code})); res(); }}));
      await tick(150);
      rejoined = !!(A.state && A.state.seats[1] && A.state.seats[1].connected);
      assert(rejoined, 'B not shown reconnected after rejoin');
    }
    await tick(10);
  }
  assert(A.state && A.state.gameWinner!=null, 'game did not finish; winner='+(A.state&&A.state.gameWinner));

  // Elo: both humans got a stats update; ratings moved opposite directions
  await tick(80);
  assert(A.statsMsgs.length>=1, 'A got no stats update');
  assert(B.statsMsgs.length>=1, 'B got no stats update');
  const dA=A.stats.rating-ratingBeforeA, dB=B.stats.rating-ratingBeforeB;
  assert(A.stats.games>=1 && B.stats.games>=1, 'games not incremented');
  // Trophies: every finished game awards them, winner more than loser, never negative
  assert(dA>0 && dB>0, 'both players should gain trophies ('+dA+','+dB+')');
  assert(dA!==dB, 'winner and loser should gain different amounts ('+dA+' vs '+dB+')');
  assert(Math.max(dA,dB)===30 && Math.min(dA,dB)===10, 'expected +30 win / +10 loss, got '+dA+'/'+dB);

  // rematch: host restarts, new hand begins
  const gamesBefore=A.state.trickCount;
  A.ws.send(JSON.stringify({t:'rematch'}));
  await tick(150);
  assert(A.state && A.state.started && A.state.gameWinner==null && A.state.phase!=='gameOver', 'rematch did not start new game; phase='+(A.state&&A.state.phase)+' started='+(A.state&&A.state.started));

  console.log('deltas A='+dA+' B='+dB+' | A.games='+A.stats.games+' B.games='+B.stats.games+' | dropped='+dropped+' rejoined='+rejoined);
  if(errs.length){ console.log('ERRORS:\n'+errs.join('\n')); process.exit(1); }
  console.log('FEATURES OK: trophies awarded (+30 win / +10 play), chat delivered, reconnect reclaimed seat, rematch restarted');
  process.exit(0);
});
