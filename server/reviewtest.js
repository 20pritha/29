process.env.USERS_DB=':memory:';
process.env.BOT_MS='2'; process.env.RESOLVE_MS='2'; process.env.NEXT_MS='2';
const { JSDOM } = require('jsdom');
const fs=require('fs'), path=require('path'), WS=require('ws');
const { server, rooms } = require('./server.js');
const ROOT=path.join(__dirname,'..'); const errs=[]; const tick=ms=>new Promise(r=>setTimeout(r,ms));
server.listen(0, async () => {
  const port=server.address().port;
  const html=fs.readFileSync(path.join(ROOT,'index.html'),'utf8').replace(/<link[^>]*>/g,'').replace(/<script[^>]*><\/script>/g,'');
  const dom=new JSDOM(html,{runScripts:'dangerously',pretendToBeVisual:true,url:'http://localhost:'+port+'/'});
  const w=dom.window; w.WebSocket=WS;
  w.addEventListener('error',e=>errs.push('win.error: '+((e.error&&e.error.stack)||e.message)));
  for(const f of ['config.js','cards.js','sound.js','online.js']){const s=w.document.createElement('script');s.textContent=fs.readFileSync(path.join(ROOT,f),'utf8');w.document.body.appendChild(s);}
  const doc=w.document, vis=id=>!doc.getElementById(id).classList.contains('hidden');
  const txt=id=>doc.getElementById(id).textContent;
  const click=el=>el&&el.dispatchEvent(new w.MouseEvent('click',{bubbles:true}));
  await tick(200);
  click(doc.getElementById('home-guest')); await tick(200);

  // BUG A: empty seats rendered as "null" and room falsely "Ready"
  click(doc.querySelector('.feature-card.green')); await tick(250);   // Play with Friends
  if(!vis('lobby-screen')) errs.push('lobby did not open');
  const seatText = txt('seat-list');
  if(/null/.test(seatText)) errs.push('BUG A: empty seats still render "null" -> '+seatText.replace(/\s+/g,' ').slice(0,80));
  if(!/Empty seat/.test(seatText)) errs.push('BUG A: empty seats not labelled');
  if(!doc.getElementById('start-btn').disabled) errs.push('BUG A: Start enabled with only 1 real player');
  if(/Ready — press Start/.test(txt('lobby-wait'))) errs.push('BUG A: falsely reports Ready');
  console.log('  seats:', seatText.replace(/\s+/g,' ').trim().slice(0,70));

  // BUG B: clicking Play Online mid-game must NOT orphan the room
  click(doc.getElementById('fill-bots-btn')); await tick(150);
  click(doc.getElementById('start-btn')); await tick(250);
  if(!vis('game-screen')) errs.push('game did not start');
  const liveCode = w.eval('me.code'); const roomsBefore = rooms.size;
  click([...doc.querySelectorAll('.nav-item')].find(a=>/Play Online/.test(a.textContent)));
  await tick(300);
  if(rooms.size > roomsBefore) errs.push('BUG B: created a new room while a match was live (orphaned it)');
  if(w.eval('me.code') !== liveCode) errs.push('BUG B: abandoned the live room (code changed)');
  if(!vis('game-screen')) errs.push('BUG B: did not return to the live game');
  console.log('  mid-game "Play Online" -> stayed in room', w.eval('me.code'), '| rooms:', rooms.size);

  // match score visible during play
  if(!/Match \d+ – \d+/.test(txt('match-score'))) errs.push('match score not shown during play: '+txt('match-score'));
  else console.log('  match score panel:', txt('match-score'));

  // play to the end -> stale turn label must be gone
  let steps=0, over=false;
  while(steps++<8000 && !over){
    if([...doc.querySelectorAll('#controls button')].some(b=>/Back to home/.test(b.textContent))){ over=true; break; }
    const pass=doc.querySelector('.pass-btn'), trump=doc.querySelector('.trump-btn'), play=doc.querySelector('#hand .card.playable');
    if(pass) click(pass); else if(trump) click(trump); else if(play) click(play);
    await tick(5);
  }
  if(!over) errs.push('match did not finish');
  if(/Resolving|trick \d+\/8/.test(txt('player-label'))) errs.push('BUG C: stale turn label on game over -> '+txt('player-label'));
  else console.log('  game over label:', txt('player-label'), '|', txt('table-message'));
  if(!/MADE it|was SET/.test(txt('game-log'))) errs.push('hand results not announced in log');

  // nav/tiles cleanup
  const nav=[...doc.querySelectorAll('.nav-item')].map(a=>a.textContent).join('|');
  if(/Club|Tournament/i.test(nav)) errs.push('Club/Tournaments still present');
  const bn=[...doc.querySelectorAll('.bn-item')].map(a=>a.textContent).join('|');
  if(/Social|Events|Shop/.test(bn)) errs.push('bottom nav still points at stubs: '+bn);
  console.log('  bottom nav:', bn.replace(/\s+/g,''));

  if(errs.length){ console.log('ERRORS:\n'+errs.join('\n')); process.exit(1); }
  console.log('REVIEW FIXES OK: real empty seats, no orphaned match, match score shown, clean game-over label, nav cleaned');
  process.exit(0);
});
