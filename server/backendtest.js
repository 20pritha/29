const { JSDOM } = require('jsdom');
const fs=require('fs'), path=require('path');
const ROOT=path.join(__dirname,'..'); const errs=[];
function urlFrom(pageUrl){
  const dom=new JSDOM('<!doctype html><body></body>',{runScripts:'dangerously',url:pageUrl});
  const w=dom.window;
  // load config.js then just the backendUrl function region by loading online.js up to it
  w.eval(fs.readFileSync(path.join(ROOT,'config.js'),'utf8'));
  // define minimal globals online.js references at module-eval time before backendUrl call
  const js=fs.readFileSync(path.join(ROOT,'online.js'),'utf8');
  // grab only the backendUrl function to avoid running the whole app/DOM
  const m=js.match(/function backendUrl\(\)[\s\S]*?\n\}/);
  w.eval(m[0]);
  return w.eval('backendUrl()');
}
const cases=[
  ['https://29-xyz.vercel.app/',      'wss://two9-yhix.onrender.com', 'Vercel front end -> Render backend'],
  ['http://localhost:8030/',          'ws://localhost:8030',          'localhost dev -> local server'],
  ['http://127.0.0.1:8030/',          'ws://127.0.0.1:8030',          '127.0.0.1 -> local server'],
  ['https://two9-yhix.onrender.com/', 'wss://two9-yhix.onrender.com', 'served by Render -> same origin'],
  ['https://site.com/?server=other.onrender.com', 'wss://other.onrender.com', '?server= override wins'],
];
for(const [page,expect,desc] of cases){
  const got=urlFrom(page);
  const ok = got===expect;
  console.log((ok?'  OK  ':'  FAIL')+' '+desc+'  ->  '+got);
  if(!ok) errs.push(desc+': got '+got+', expected '+expect);
}
if(errs.length){ console.log('ERRORS:\n'+errs.join('\n')); process.exit(1); }
console.log('BACKEND URL OK: hosted front ends reach the game server; localhost stays local');
