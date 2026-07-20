process.env.USERS_DB=':memory:';
const { JSDOM } = require('jsdom');
const fs=require('fs'), path=require('path'), WS=require('ws');
const { server } = require('./server.js');
const ROOT=path.join(__dirname,'..'); const errs=[];
const tick=ms=>new Promise(r=>setTimeout(r,ms));
server.listen(0, async () => {
  const port=server.address().port;
  const html=fs.readFileSync(path.join(ROOT,'index.html'),'utf8').replace(/<link[^>]*>/g,'').replace(/<script[^>]*><\/script>/g,'');
  const dom=new JSDOM(html,{runScripts:'dangerously',pretendToBeVisual:true,url:'http://localhost:'+port+'/'});
  const w=dom.window; w.WebSocket=WS;
  w.addEventListener('error',e=>errs.push('win.error: '+((e.error&&e.error.stack)||e.message)));
  for(const f of ['config.js','cards.js','sound.js','online.js']){const s=w.document.createElement('script');s.textContent=fs.readFileSync(path.join(ROOT,f),'utf8');w.document.body.appendChild(s);}
  const doc=w.document, vis=id=>!doc.getElementById(id).classList.contains('hidden');
  const click=el=>el&&el.dispatchEvent(new w.MouseEvent('click',{bubbles:true}));

  // 1) IMMEDIATELY click Create account — before the socket can finish connecting.
  //    This is the exact case that used to silently do nothing.
  doc.getElementById('auth-user').value='EarlyBird'+(Date.now()%100000);
  doc.getElementById('auth-pass').value='secret123';
  click(doc.getElementById('register-btn'));      // fired while still CONNECTING
  await tick(1200);
  if(!vis('app')) errs.push('early click was lost — never signed in');
  else console.log('  early click survived -> signed in as', doc.getElementById('tb-name').textContent);

  // 2) kill the socket and confirm it reconnects by itself
  const before = doc.getElementById('tb-name').textContent;
  w.eval('ws.close()');
  await tick(400);
  const banner = doc.getElementById('conn-status').textContent;
  await tick(3000);
  const reconnected = !doc.getElementById('app').classList.contains('hidden')
    && doc.getElementById('tb-name').textContent === before;
  if(!reconnected) errs.push('did not recover after the socket dropped');
  else console.log('  socket dropped -> banner said "'+banner+'" -> auto-reconnected, still signed in');

  // 3) a real validation error must be visible to the user
  w.eval("show('auth-screen')");
  doc.getElementById('auth-user').value='x';       // too short
  doc.getElementById('auth-pass').value='1';
  click(doc.getElementById('register-btn'));
  await tick(500);
  const msg=doc.getElementById('auth-msg').textContent;
  if(!msg) errs.push('validation error not shown to the user');
  else console.log('  invalid signup shows:', JSON.stringify(msg));

  if(errs.length){ console.log('ERRORS:\n'+errs.join('\n')); process.exit(1); }
  console.log('SIGNUP FIXED: early clicks are queued and sent, socket auto-reconnects, errors are visible');
  process.exit(0);
});
