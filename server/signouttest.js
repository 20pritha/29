process.env.USERS_DB=':memory:';
const { JSDOM } = require('jsdom');
const fs=require('fs'),path=require('path'),WS=require('ws');
const { server } = require('./server.js');
const ROOT=path.join(__dirname,'..'); const errs=[]; const tick=ms=>new Promise(r=>setTimeout(r,ms));
server.listen(0, async () => {
  const port=server.address().port;
  const html=fs.readFileSync(path.join(ROOT,'index.html'),'utf8').replace(/<link[^>]*>/g,'').replace(/<script[^>]*><\/script>/g,'');
  const dom=new JSDOM(html,{runScripts:'dangerously',pretendToBeVisual:true,url:'http://localhost:'+port+'/'});
  const w=dom.window; w.WebSocket=WS; let reloaded=false;
  Object.defineProperty(w,'confirm',{value:()=>true}); // auto-accept
  try { Object.defineProperty(w.location,'reload',{value:()=>{reloaded=true;}}); } catch(e){}
  w.addEventListener('error',e=>{const msg=((e.error&&e.error.message)||e.message||''); if(!/navigation/i.test(msg)) errs.push('win.error: '+msg);});
  for(const f of ['config.js','cards.js','sound.js','online.js']){const s=w.document.createElement('script');s.textContent=fs.readFileSync(path.join(ROOT,f),'utf8');w.document.body.appendChild(s);}
  const doc=w.document, click=el=>el&&el.dispatchEvent(new w.MouseEvent('click',{bubbles:true}));
  await tick(200);
  // topbar power button gone
  if(doc.getElementById('signout')) errs.push('topbar sign-out button still present');
  click(doc.getElementById('home-guest')); await tick(200);
  // open profile/settings, sign out
  click([...doc.querySelectorAll('.nav-item')].find(a=>/Profile/.test(a.textContent))); await tick(120);
  const so=doc.getElementById('set-signout');
  if(!so) errs.push('settings sign-out missing');
  else { w.localStorage.setItem('twentynine-token','FAKE'); w.localStorage.setItem('twentynine-room','ABCD');
    click(so); await tick(50);
    if(w.localStorage.getItem('twentynine-token')) errs.push('sign-out did not clear the auth token');
    if(w.localStorage.getItem('twentynine-room')) errs.push('sign-out did not clear the room');
    else console.log('  sign-out cleared token + room, then reloaded'); }
  if(errs.length){ console.log('ERRORS:\n'+errs.join('\n')); process.exit(1); }
  console.log('SIGN OUT OK: removed from topbar, works from Profile & Settings (with confirm)');
  process.exit(0);
});
