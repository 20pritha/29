const { server } = require('./server.js');
const WS = require('ws');
const mode = process.argv[2]; // 'register' | 'login'
server.listen(0, () => {
  const ws = new WS('ws://localhost:' + server.address().port);
  ws.on('open', () => ws.send(JSON.stringify({ t: mode === 'register' ? 'register' : 'login', user: 'DurableUser', pass: 'durablepw' })));
  ws.on('message', (d) => {
    const m = JSON.parse(d.toString());
    if (m.t === 'authOk') { console.log(mode + ': authOk (user=' + m.user + ', coins=' + m.stats.coins + ')'); process.exit(0); }
    if (m.t === 'authErr') { console.log(mode + ': authErr — ' + m.msg); process.exit(1); }
  });
});
