process.env.USERS_DB='/tmp/29arch.db';
process.env.BOT_MS='2'; process.env.RESOLVE_MS='2'; process.env.NEXT_MS='2';
const { server, makeEngine } = require('./server.js');
const store = require('./db');
const WS = require('ws');
const errs=[]; const tick=ms=>new Promise(r=>setTimeout(r,ms));
server.listen(0, async () => {
  const ws = new WS('ws://localhost:'+server.address().port);
  let state=null, statsMsg=null;
  ws.on('message', d => { const m=JSON.parse(d);
    if(m.t==='authOk') ws.send(JSON.stringify({t:'createRoom'}));
    if(m.t==='joined'){ ws.send(JSON.stringify({t:'fillBots'})); setTimeout(()=>ws.send(JSON.stringify({t:'start'})),60); }
    if(m.t==='state'){ state=m;
      if(m.you===m.turn && !m.resolving){
        if(m.phase==='bidding'&&m.canBid) ws.send(JSON.stringify({t:'action',action:'pass'}));
        else if(m.phase==='chooseTrump'&&m.trumpChoices) ws.send(JSON.stringify({t:'action',action:'trump',suit:m.trumpChoices[0]}));
        else if(m.phase==='play'&&m.legal) ws.send(JSON.stringify({t:'action',action:'play',cardId:m.legal[0]}));
      } }
    if(m.t==='stats') statsMsg=m;
  });
  ws.on('open', ()=> ws.send(JSON.stringify({t:'guest'})));

  const t0=Date.now();
  while(Date.now()-t0 < 20000 && !statsMsg) await tick(20);
  if(!statsMsg){ console.log('game did not finish'); process.exit(1); }
  await tick(100);

  const row = statsMsg.stats.matches[0];
  if(!row || !row.gameId) errs.push('match row missing gameId');
  if(!row.seed) errs.push('match row missing seed');
  if(row.version !== 1) errs.push('match row missing/incorrect version');

  const g = store.getGame(row.gameId);
  if(!g) errs.push('game not archived in DB');
  else {
    if(g.version!==1) errs.push('archived version wrong');
    if(!g.log || !g.log.length) errs.push('archived log empty');
    // replay the archived log in a FRESH engine and compare the outcome
    const fresh = makeEngine().G;
    const re = fresh.replay(g.log);
    if(re.winner !== g.winner) errs.push('replay winner '+re.winner+' != archived '+g.winner);
    if(re.seed !== g.seed) errs.push('replay seed mismatch');
    console.log('archived game '+row.gameId.slice(0,8)+' | seed '+g.seed+' | log entries '+g.log.length
      + ' | winner '+g.winner+' | replayed winner '+re.winner+' | match '+re.matchPoints.join('-'));
  }
  if(errs.length){ console.log('ERRORS:\n'+errs.join('\n')); process.exit(1); }
  console.log('ARCHIVE OK: match stored with seed+version+log, and replays from the DB to the identical winner');
  process.exit(0);
});
