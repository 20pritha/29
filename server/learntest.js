process.env.USERS_DB=':memory:';
process.env.BOT_MS='2'; process.env.RESOLVE_MS='2'; process.env.NEXT_MS='2';
const { JSDOM } = require('jsdom');
const fs=require('fs'), path=require('path'), WS=require('ws');
const { server } = require('./server.js');
const ROOT=path.join(__dirname,'..'); const errs=[];
server.listen(0, async () => {
  const port=server.address().port;
  const html=fs.readFileSync(path.join(ROOT,'index.html'),'utf8').replace(/<link[^>]*>/g,'').replace(/<script[^>]*><\/script>/g,'');
  const dom=new JSDOM(html,{runScripts:'dangerously',pretendToBeVisual:true,url:'http://localhost:'+port+'/'});
  const w=dom.window; w.WebSocket=WS;
  w.addEventListener('error',e=>errs.push('win.error: '+((e.error&&e.error.stack)||e.message)));
  for(const f of ['config.js','cards.js','sound.js','online.js']){const s=w.document.createElement('script');s.textContent=fs.readFileSync(path.join(ROOT,f),'utf8');w.document.body.appendChild(s);}
  const doc=w.document, vis=id=>!doc.getElementById(id).classList.contains('hidden');
  const click=el=>el&&el.dispatchEvent(new w.MouseEvent('click',{bubbles:true}));
  const tick=ms=>new Promise(r=>setTimeout(r,ms));
  await tick(150);
  click(doc.getElementById('home-guest')); await tick(180);

  // Learn 29
  click([...doc.querySelectorAll('.nav-item')].find(a=>/Learn 29/.test(a.textContent))); await tick(80);
  if(!vis('learn-screen')) errs.push('learn screen did not open');
  const rank=doc.getElementById('learn-rank'), pts=doc.getElementById('learn-points');
  if(rank.children.length!==8) errs.push('rank ladder should show 8 cards, got '+rank.children.length);
  if(pts.children.length!==4) errs.push('points row should show 4 ranks, got '+pts.children.length);
  const first=rank.children[0].querySelector('.rank').textContent;
  const last=rank.children[7].querySelector('.rank').textContent;
  if(first!=='J') errs.push('strongest card should be J, got '+first);
  if(last!=='7') errs.push('weakest card should be 7, got '+last);

  // Settings + accessibility toggles
  click([...doc.querySelectorAll('.nav-item')].find(a=>/Settings/.test(a.textContent))); await tick(80);
  if(!vis('settings-screen')) errs.push('settings screen did not open');
  const cb=doc.getElementById('set-colorblind'); cb.checked=true; cb.dispatchEvent(new w.Event('change')); await tick(30);
  if(!doc.body.classList.contains('cb')) errs.push('colour-blind mode not applied');
  const big=doc.getElementById('set-bigcards'); big.checked=true; big.dispatchEvent(new w.Event('change')); await tick(30);
  if(!doc.body.classList.contains('big-cards')) errs.push('large cards not applied');
  const mo=doc.getElementById('set-motion'); mo.checked=true; mo.dispatchEvent(new w.Event('change')); await tick(30);
  if(!doc.body.classList.contains('reduce-motion')) errs.push('reduce motion not applied');
  if(!/guest/i.test(doc.getElementById('set-account').textContent)) errs.push('account line missing');
  // prefs persisted?
  const saved=JSON.parse(w.localStorage.getItem('twentynine-prefs')||'{}');
  if(!saved.colorblind||!saved.bigCards||!saved.reduceMotion) errs.push('prefs not persisted: '+JSON.stringify(saved));
  // suit classes present for colour-blind styling
  click([...doc.querySelectorAll('.nav-item')].find(a=>/Learn 29/.test(a.textContent))); await tick(50);
  if(!rank.querySelector('.card.suit-spades')) errs.push('cards missing suit-* class for CB mode');

  if(errs.length){ console.log('ERRORS:\n'+errs.join('\n')); process.exit(1); }
  console.log('LEARN+SETTINGS OK: tutorial builds 8-card ladder (J high → 7 low) + 4 scoring ranks from engine constants; colour-blind / large-cards / reduce-motion apply and persist');
  process.exit(0);
});
