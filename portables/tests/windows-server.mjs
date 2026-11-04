// Teste le vrai serveur PowerShell sans ouvrir le profil habituel du navigateur.
import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { request } from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
if (process.platform !== 'win32') { console.log('SKIP : serveur Windows.'); process.exit(0); }
const occupied = createServer();
await new Promise(resolve => occupied.listen(0,'127.0.0.1',resolve));
const port = occupied.address().port;
const child = spawn('powershell',['-NoProfile','-ExecutionPolicy','Bypass','-File',fileURLToPath(new URL('../serveur.ps1',import.meta.url)),'-PortDepart',String(port),'-SansNavigateur'],{windowsHide:true});
let output = '';
const url = await new Promise((resolve,reject) => {
  const timeout = setTimeout(()=>reject(new Error(`Serveur non prêt : ${output}`)),10000);
  child.stdout.on('data', bytes => {
    output += bytes;
    const match = /http:\/\/127\.0\.0\.1:(\d+)\//.exec(output);
    if (match) { clearTimeout(timeout); resolve(match[0]); }
  });
  child.stderr.on('data', bytes => { output += bytes; });
  child.once('exit',code=>{clearTimeout(timeout);reject(new Error(`Serveur arrêté (${code}) : ${output}`));});
});
const raw = path => new Promise((resolve,reject)=>{
  const req = request(url,{path},res=>{res.resume();res.on('end',()=>resolve(res.statusCode));});
  req.on('error',reject);req.end();
});
try {
  assert.notEqual(Number(new URL(url).port),port);
  const page = await fetch(url);
  assert.equal(page.status,200);
  const html = await page.text();
  assert.match(html, /<title>EMUPERSO/);
  assert.match(html, /id="romInput"/);
  const head = await fetch(url+'js/app.mjs',{method:'HEAD'});
  assert.equal(head.status,200);
  assert.match(head.headers.get('content-type'),/text\/javascript/);
  assert.equal((await head.text()).length,0);
  assert.equal((await fetch(url+'absent')).status,404);
  assert.equal((await fetch(url,{method:'POST'})).status,405);
  assert.equal(await raw('/%2e%2e/package.json'),403);
  assert.equal(await raw('/..%5cpackage.json'),403);
  console.log('PASS Windows PowerShell : port occupé contourné, GET, HEAD, MIME modules, 404, 405 et traversées refusées.');
} finally {
  child.kill();
  await new Promise(resolve=>occupied.close(resolve));
}
