process.env.USERS_DB=':memory:';
process.env.BOT_MS='2'; process.env.RESOLVE_MS='2'; process.env.NEXT_MS='2';
const { JSDOM } = require('jsdom');
const fs=require('fs'), path=require('path'), WS=require('ws');
const { server } = require('./server.js');
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

  // Club / Tournaments gone
  const nav=[...doc.querySelectorAll('.nav-item')].map(a=>a.textContent).join('|');
  if(/Club|Tournament/i.test(nav)) errs.push('Club/Tournaments still in nav: '+nav);

  // starts at Bronze 0
  if(!/Bronze/.test(txt('rc-tier'))) errs.push('new player should be Bronze, got '+txt('rc-tier'));
  if(!/0 trophies/.test(txt('rc-rating'))) errs.push('should start at 0 trophies, got '+txt('rc-rating'));

  // VIEW RANK opens the ranked screen with next-rank requirement
  click(doc.querySelector('.feature-card.blue')); await tick(120);
  if(!vis('ranked-screen')) errs.push('View Rank did not open ranked screen');
  if(txt('rk-trophies')!=='0') errs.push('ranked screen trophies wrong: '+txt('rk-trophies'));
  if(!/300 more trophies to reach Silver/.test(txt('rk-next'))) errs.push('next-rank text wrong: '+txt('rk-next'));
  if(doc.getElementById('rk-ladder').children.length!==5) errs.push('ladder should list 5 ranks');
  if(!doc.querySelector('.rank-row.current')) errs.push('current rank not highlighted');
  console.log('  ranked screen ->', txt('rk-tier'), '|', txt('rk-next'));

  // lobby is the centred card with a big code
  click(doc.querySelector('.feature-card.teal')); await tick(150);
  if(!vis('lobby-screen')) errs.push('lobby did not open');
  if(!doc.querySelector('#lobby-screen .centred')) errs.push('lobby not using centred layout');
  if(!doc.querySelector('.lobby-code')) errs.push('lobby missing big room code');
  if(!/^[A-Z0-9]{4}$/.test(txt('room-code'))) errs.push('room code not shown: '+txt('room-code'));

  // play a full game -> trophies must increase
  click(doc.getElementById('fill-bots-btn')); await tick(150);
  click(doc.getElementById('start-btn')); await tick(200);
  let steps=0, over=false;
  while(steps++<6000 && !over){
    if([...doc.querySelectorAll('#controls button')].some(b=>/Back to home/.test(b.textContent))){ over=true; break; }
    const pass=doc.querySelector('.pass-btn'), trump=doc.querySelector('.trump-btn'), play=doc.querySelector('#hand .card.playable');
    if(pass) click(pass); else if(trump) click(trump); else if(play) click(play);
    await tick(5);
  }
  if(!over) errs.push('game did not finish');
  await tick(150);
  click([...doc.querySelectorAll('.nav-item')].find(a=>/Ranked/.test(a.textContent))); await tick(120);
  const after=Number(txt('rk-trophies'));
  if(!(after>0)) errs.push('TROPHIES NOT AWARDED after a game: '+after);
  else console.log('  after one game ->', after, 'trophies |', txt('rk-next'));

  if(errs.length){ console.log('ERRORS:\n'+errs.join('\n')); process.exit(1); }
  console.log('RANK/LOBBY OK: starts Bronze 0, View Rank shows next-rank requirement, lobby centred, game awarded trophies');
  process.exit(0);
});
