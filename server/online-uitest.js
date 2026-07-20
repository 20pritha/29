process.env.BOT_MS='2'; process.env.RESOLVE_MS='2'; process.env.NEXT_MS='2';
const { JSDOM } = require('jsdom');
const fs = require('fs'); const path = require('path'); const WS = require('ws');
const { server } = require('./server.js');
const ROOT = path.join(__dirname, '..');
const errs = [];
server.listen(0, async () => {
  const port = server.address().port;
  const html = fs.readFileSync(path.join(ROOT,'index.html'),'utf8').replace(/<link[^>]*>/g,'').replace(/<script[^>]*><\/script>/g,'');
  const dom = new JSDOM(html, { runScripts:'dangerously', pretendToBeVisual:true, url:'http://localhost:'+port+'/' });
  const w = dom.window; w.WebSocket = WS;
  w.addEventListener('error', e => errs.push('win.error: '+((e.error&&e.error.stack)||e.message)));
  for (const f of ['cards.js','sound.js','online.js']) { const s=w.document.createElement('script'); s.textContent=fs.readFileSync(path.join(ROOT,f),'utf8'); w.document.body.appendChild(s); }
  const doc=w.document; const vis=id=>!doc.getElementById(id).classList.contains('hidden');
  const txt=id=>doc.getElementById(id).textContent;
  const click=el=>el&&el.dispatchEvent(new w.MouseEvent('click',{bubbles:true}));
  const tick=ms=>new Promise(r=>setTimeout(r,ms));

  await tick(150);
  // 1) splash first
  if(!vis('home-screen')) errs.push('home splash not first');
  if(!vis('app')===false) {} // app hidden initially
  if(vis('app')) errs.push('app shell should be hidden at splash');

  // 2) login shows auth, back returns
  click(doc.getElementById('home-login')); await tick(20);
  if(!vis('auth-screen')) errs.push('login did not show auth');
  click(doc.getElementById('auth-back')); await tick(20);
  if(!vis('home-screen')) errs.push('back did not return to splash');

  // 3) guest → app shell + dashboard
  click(doc.getElementById('home-guest')); await tick(160);
  if(!vis('app')) errs.push('app shell not shown after guest');
  if(!vis('entry-screen')) errs.push('dashboard view not shown');
  if(!/Guest/.test(txt('tb-name'))) errs.push('topbar name not guest: '+txt('tb-name'));
  if(!/Bronze|Silver|Gold|Diamond|Legend/.test(txt('rc-tier'))) errs.push('ranked tier missing: '+txt('rc-tier'));
  if(!/Ends in/.test(txt('season'))) errs.push('season countdown missing');
  if(txt('tb-coins')!=='0') errs.push('coins not 0 at start: '+txt('tb-coins'));
  if(!/No matches yet/.test(txt('match-list'))) errs.push('match list empty state missing');

  // 4) daily reward → +100 coins in topbar
  click(doc.getElementById('daily-btn')); await tick(80);
  if(txt('tb-coins')!=='100') errs.push('daily reward coins not granted: '+txt('tb-coins'));

  // 5) create room (click the Play Online feature card) → lobby → start
  click(doc.querySelector('.feature-card.teal')); await tick(120);
  if(!vis('lobby-screen')) errs.push('no lobby after create');
  click(doc.getElementById('fill-bots-btn')); await tick(120);
  click(doc.getElementById('start-btn')); await tick(150);
  if(!vis('game-screen')) errs.push('no game screen after start');

  // 6) play to game over
  let steps=0, over=false;
  while(steps++<6000 && !over){
    if([...doc.querySelectorAll('#controls button')].some(b=>/Back to home/.test(b.textContent))){ over=true; break; }
    const pass=doc.querySelector('.pass-btn'), trump=doc.querySelector('.trump-btn'), reveal=doc.querySelector('.reveal-btn'), play=doc.querySelector('#hand .card.playable');
    if(pass) click(pass); else if(trump) click(trump); else if(reveal&&Math.random()<0.3) click(reveal); else if(play) click(play);
    await tick(5);
  }
  if(!over) errs.push('game did not reach game over');
  await tick(80);
  const coinsAfter = Number(txt('tb-coins'));
  if(!(coinsAfter>100)) errs.push('match did not award coins: '+coinsAfter);
  // match history should now have a row
  if(/No matches yet/.test(txt('match-list'))) errs.push('match history not recorded');
  // game log should have accumulated lines
  if(doc.getElementById('game-log').children.length < 3) errs.push('game log did not accumulate');

  if(errs.length){ console.log('ERRORS:\n'+errs.join('\n')); process.exit(1); }
  console.log('STUDIO UI OK: splash → guest → dashboard(rank/season/coins) → daily +100 → room → table(side panels, game log) → game over → match history + coins='+coinsAfter);
  process.exit(0);
});
