import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,copyFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {spawn} from 'node:child_process';
import {request} from 'node:http';

test('serveur du portail : URL malformée isolée, méthodes et types PWA/APK', async () => {
  const root=mkdtempSync(join(tmpdir(),'emuperso-server-'));
  mkdirSync(join(root,'tools'));mkdirSync(join(root,'dist'));
  copyFileSync(new URL('../tools/serve-portail.mjs',import.meta.url),join(root,'tools/serve-portail.mjs'));
  writeFileSync(join(root,'vercel.json'),JSON.stringify({headers:[]}));
  for(const name of ['index.html','manifest.webmanifest','test.apk'])writeFileSync(join(root,'dist',name),'fixture');
  const moduleUrl=pathToFileURL(join(root,'tools/serve-portail.mjs')).href;
  const child=spawn(process.execPath,['--input-type=module','-e',`import {startPortail} from ${JSON.stringify(moduleUrl)}; const s=await startPortail();console.log(s.url);`],{windowsHide:true});
  let log='';child.stderr.on('data',b=>{log+=b;});
  try{
    const url=await new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>reject(Error('Démarrage serveur trop lent : '+log)),5000);
      child.stdout.on('data',b=>{const m=/http:\/\/127\.0\.0\.1:\d+\//.exec(String(b));if(m){clearTimeout(timer);resolve(m[0]);}});
      child.once('exit',code=>{clearTimeout(timer);reject(Error('Serveur arrêté : '+code+' '+log));});
    });
    const raw=(path,method='GET')=>new Promise(resolve=>{
      const req=request(url,{path,method},res=>{res.resume();res.on('end',()=>resolve({status:res.statusCode,type:res.headers['content-type']}));});
      req.on('error',e=>resolve({status:null,error:e.message}));req.end();
    });
    assert.equal((await raw('/%E0%A4%A')).status,400,'URL invalide : réponse 400 sans arrêter le serveur');
    assert.equal((await raw('/')).status,200,'serveur toujours disponible');
    assert.equal((await raw('/','POST')).status,405);
    assert.match((await raw('/manifest.webmanifest')).type,/application\/manifest\+json/);
    assert.equal((await raw('/test.apk')).type,'application/vnd.android.package-archive');
  }finally{
    if(child.exitCode===null){const stopped=new Promise(resolve=>child.once('exit',resolve));child.kill();await stopped;}
    rmSync(root,{recursive:true,force:true});
  }
});
