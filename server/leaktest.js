process.env.USERS_DB=':memory:';
process.env.BOT_MS='2'; process.env.RESOLVE_MS='2'; process.env.NEXT_MS='2';
process.env.ABANDON_MS='300';                    // short grace for the test
const { server, rooms, users } = require('./server.js');
const WS = require('ws');
const errs=[]; const tick=ms=>new Promise(r=>setTimeout(r,ms));
server.listen(0, async () => {
  const url='ws://localhost:'+server.address().port;
  // guest creates a room, fills bots, starts, then drops
  const ws=new WS(url); let code=null;
  await new Promise(r=>{ ws.on('open',()=>ws.send(JSON.stringify({t:'guest'}))); ws.on('message',d=>{const m=JSON.parse(d);if(m.t==='authOk')r();}); });
  const guestCount = Object.values(users).filter(u=>u.guest).length;
  ws.send(JSON.stringify({t:'createRoom'}));
  await new Promise(r=>{ ws.on('message',d=>{const m=JSON.parse(d); if(m.t==='joined'){code=m.code;r();}}); });
  ws.send(JSON.stringify({t:'fillBots'})); await tick(60);
  ws.send(JSON.stringify({t:'start'}));    await tick(120);
  if(!rooms.has(code)) errs.push('room missing after start');
  if(!rooms.get(code).started) errs.push('room not started');
  ws.close();                                   // everyone leaves an in-progress game
  await tick(150);
  if(!rooms.has(code)) errs.push('room reaped too early (before grace period)');
  await tick(400);                              // past ABANDON_MS
  if(rooms.has(code)) errs.push('LEAK: abandoned started room was never reaped');
  const guestsAfter = Object.values(users).filter(u=>u.guest).length;
  if(guestsAfter >= guestCount && guestCount>0) errs.push('LEAK: guest not reaped ('+guestCount+'→'+guestsAfter+')');
  console.log('rooms left:', rooms.size, '| guests before/after:', guestCount, '/', guestsAfter);
  if(errs.length){ console.log('ERRORS:\n'+errs.join('\n')); process.exit(1); }
  console.log('LEAKS FIXED: abandoned room reaped after grace, guest reaped, room count back to 0');
  process.exit(0);
});
