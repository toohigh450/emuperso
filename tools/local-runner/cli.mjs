import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {HERE,config,readJSON,atomic,append,sleep,processInfo,killOwned,waitOwnedExit,resourceSample,bytesIn,removeTemporary,STATUS,stamp,fileHash} from './lib.mjs';
import {inventory} from './inventory.mjs';
import {attempts,report} from './report.mjs';

const args=process.argv.slice(2),command=args.shift()||'help';
const arg=(k,d=null)=>{const i=args.indexOf('--'+k);return i<0?d:args[i+1];};
if(command==='help') {
  console.log('LAB.bat init | inventory | run | pause | stop | resume | report | status\nOptions : --config chemin --system gb --match texte --limit 10 --id identifiant --timeout-ms 150000\nrun/resume restent actifs dans cette fenêtre. START-BACKGROUND.ps1 lance sans fenêtre.');process.exit(0);
}
if(command==='init') {
  const dest=path.resolve(arg('config',path.join(HERE,'config.local.json')));
  if(fs.existsSync(dest))throw Error('Configuration déjà présente : elle est conservée.');
  fs.copyFileSync(path.join(HERE,'config.example.json'),dest);console.log('Configuration créée : '+dest);process.exit(0);
}
const c=config(arg('config'));
if(arg('timeout-ms')) {c.timeoutMs=Number(arg('timeout-ms'));if(!Number.isFinite(c.timeoutMs)||c.timeoutMs<1000)throw Error('Délai minimal : 1000 ms');}
fs.mkdirSync(c.stateDir,{recursive:true});
const marker=name=>path.join(c.stateDir,name+'.flag');
if(['pause','stop'].includes(command)) {fs.writeFileSync(marker(command),new Date().toISOString());append(c,{event:command});console.log(command==='pause'?'Pause demandée : le jeu en cours se termine.':'Arrêt demandé : les jeux actifs seront interrompus et repris plus tard.');process.exit(0);}
if(['status','report'].includes(command)){const r=report(c);console.log(JSON.stringify({total:r.total,tested:r.tested,remaining:r.remaining,counts:r.counts,report:path.join(c.stateDir,'rapport.html')},null,2));process.exit(0);}
if(!['inventory','run','resume'].includes(command))throw Error('Commande inconnue : '+command);

const lock=path.join(c.stateDir,'runner.lock');
async function acquire() {
  const owner=await processInfo(process.pid);
  const old=readJSON(lock);
  if(old) {
    const live=await processInfo(old.pid);
    if(live&&live.created===old.created)throw Error('Un inventaire/testeur est déjà actif pour cette campagne.');
    // Le vieux verrou est conservé dans le journal avant d'être remplacé.
    append(c,{event:'stale-lock',owner:old});fs.unlinkSync(lock);
  }
  const fd=fs.openSync(lock,'wx');
  try {fs.writeFileSync(fd,JSON.stringify(owner||{pid:process.pid,created:new Date().toISOString()}));}finally{fs.closeSync(fd);}
}
await acquire();
let stopping=false;
for(const signal of ['SIGINT','SIGTERM','SIGBREAK'])process.on(signal,()=>{stopping=true;});
const active=new Map();let monitorBusy=false,lastResources=null,finishedJobs=0,sessionStart=Date.now(),campaign=readJSON(path.join(c.stateDir,'campaign.json'),{activeMs:0,sessions:0}),baseActive=campaign.activeMs;
const saveCampaign=()=>atomic(path.join(c.stateDir,'campaign.json'),{...campaign,activeMs:baseActive+Date.now()-sessionStart,lastSeen:new Date().toISOString()});
async function recover() {
  for(const a of attempts(c)) {
    const dir=path.join(c.stateDir,'attempts',a.dir);
    if(a.result&&readJSON(path.join(dir,'cleanup.json'))?.complete)continue;
    // Vérification PID + date de création + jeton, jamais par nom chrome.exe/node.exe.
    await killOwned(readJSON(path.join(dir,'worker-owner.json')));
    const recoveryBrowser=readJSON(path.join(dir,'browser-owner.json'));
    await killOwned(recoveryBrowser);
    if(!await waitOwnedExit(recoveryBrowser))throw Error('Ancien navigateur encore actif : reprise differee, aucun nouveau jeu lance.');
    const previousCleanup=readJSON(path.join(dir,'cleanup.json'));
    if(previousCleanup?.complete===false)atomic(path.join(dir,'cleanup.json'),{...previousCleanup,complete:true,browserAlive:false,recoveredDuringResume:new Date().toISOString()});
    if(!a.result){const p=readJSON(path.join(dir,'progress.json'),{});atomic(path.join(dir,'result.json'),{...p,id:a.item.id,attempt:a.attempt,interrupted:true,interruptionReason:'Processus superviseur interrompu ; reprise automatique.',status:STATUS.untested,end:new Date().toISOString()});append(c,{event:'recovered-interruption',id:a.item.id,attempt:a.attempt});}
    const tmp=path.join(c.stateDir,'tmp',a.token);
    if(a.token&&/^[a-f0-9-]{36}$/.test(a.token)&&fs.existsSync(tmp))removeTemporary(c,tmp);
  }
}
async function monitor() {
  if(monitorBusy)return;monitorBusy=true;
  try {
    lastResources=await resourceSample([...active.values()].map(a=>a.child.pid));
    fs.appendFileSync(path.join(c.stateDir,'resources.ndjson'),JSON.stringify({time:new Date().toISOString(),...lastResources})+'\n');
    for(const a of active.values()){
      const progress=readJSON(path.join(a.out,'progress.json'),{});
      console.log(`EN COURS ${a.item.system.toUpperCase()} | ${a.phase||progress.phase||'preparation'} | ${Math.round((Date.now()-a.start)/1000)} s | CPU ${lastResources.cpuPercent??'?'} % | RAM libre ${(lastResources.freeMiB/1024).toFixed(1)} Gio`);
    }
    const byPID=new Map(lastResources.processes.map(p=>[p.pid,p]));
    for(const a of active.values()) {
      let ids=new Set([a.child.pid]),changed=true;
      while(changed){changed=false;for(const p of byPID.values())if(ids.has(p.parent)&&!ids.has(p.pid)){ids.add(p.pid);changed=true;}}
      const rss=[...ids].reduce((n,p)=>n+(byPID.get(p)?.rssMiB||0),0);a.peakRssMiB=Math.max(a.peakRssMiB||0,rss);
      if(rss>c.maxTreeMemoryMiB){a.reason='Plafond RAM du processus dépassé : '+rss+' Mio';a.abort();}
    }
  }catch(e){append(c,{event:'resource-monitor-error',error:e.message});lastResources=null;}
  finally{monitorBusy=false;saveCampaign();}
}
async function one(item,number) {
  const token=randomUUID(),dirName=item.id+'-'+String(number).padStart(3,'0')+'-'+token;
  const out=path.join(c.stateDir,'attempts',dirName);fs.mkdirSync(out,{recursive:true});
  const job={item,attempt:number,token,start:new Date().toISOString()};atomic(path.join(out,'job.json'),job);
  const log=fs.openSync(path.join(out,'worker.log'),'a');
  const child=spawn(process.execPath,[path.join(HERE,'worker.mjs'),c.filename,path.join(out,'job.json'),token],{windowsHide:true,stdio:['ignore',log,log,'ipc'],env:{...process.env,EMUPERSO_TIMEOUT_MS:String(c.timeoutMs)}});
  fs.closeSync(log);
  const a={child,out,token,item,start:Date.now(),peakRssMiB:0};active.set(token,a);
  let aborting=false;
  a.abort=async()=>{
    if(aborting)return;aborting=true;
    // Ce handle vient directement de spawn : il désigne notre enfant, sans recherche CIM
    // et sans risque de viser un PID réutilisé pendant un délai de surveillance Windows.
    child.kill();
    await killOwned(readJSON(path.join(out,'browser-owner.json')));
  };
  const timer=setTimeout(()=>{a.timeout=true;a.reason='Délai global dépassé';a.abort();},c.timeoutMs);
  let resolveExit;const exited=new Promise(resolve=>{resolveExit=resolve;});
  child.on('error',e=>{a.spawnError=e.message;resolveExit({code:null,error:e.message});});
  child.on('exit',(code,signal)=>resolveExit({code,signal}));
  child.on('message',m=>{if(m.browserOwner)atomic(path.join(out,'browser-owner.json'),m.browserOwner);});
  append(c,{event:'start',id:item.id,attempt:number,pid:child.pid,token});
  console.log(`DÉBUT ${item.system} ${item.name} (${number})`);
  a.owner=await processInfo(child.pid);if(a.owner){a.owner.token=token;atomic(path.join(out,'worker-owner.json'),a.owner);}
  if(stopping) {a.reason='Arrêt demandé';a.abort();}
  const exit=await exited;clearTimeout(timer);
  const workerExitMs=Date.now()-a.start;
  a.phase='fermeture du navigateur';
  // Inclut les descendants Chrome survivant à une fermeture défectueuse du worker.
  const cleanupActions=[await killOwned(readJSON(path.join(out,'browser-owner.json')))];
  let result=readJSON(path.join(out,'result.json'));
  if(!result) {
    const p=readJSON(path.join(out,'progress.json'),{});
    result={...p,id:item.id,system:item.system,name:item.name,attempt:number,start:job.start,end:new Date().toISOString(),elapsedMs:Date.now()-a.start,timeout:!!a.timeout,interrupted:!a.timeout&&a.reason==='Arrêt demandé',interruptionReason:a.reason,status:a.timeout?STATUS.timeout:a.reason==='Arrêt demandé'?STATUS.untested:STATUS.fail,error:a.reason||a.spawnError||`Worker terminé sans résultat (${exit.code})`};
  }
  if(a.timeout){result.timeout=true;result.status=STATUS.timeout;result.interruptionReason=a.reason;}
  if(!result.originalSha256After&&result.originalSha256)try{result.originalAfter=stamp(item.path);result.originalSha256After=await fileHash(item.path);result.originalChanged=JSON.stringify(result.originalBefore)!==JSON.stringify(result.originalAfter)||result.originalSha256!==result.originalSha256After;}catch(e){result.verificationError=e.message;}
  result.supervisor={exit,workerExitMs,peakRssMiB:a.peakRssMiB,deadlineMs:c.timeoutMs,reason:a.reason||null};
  atomic(path.join(out,'result.json'),result);
  const browserOwner=readJSON(path.join(out,'browser-owner.json'));
  // Windows peut conserver brièvement un processus Chrome en cours de terminaison dans CIM.
  // Attendre sa disparition réelle avant de conclure à un navigateur survivant.
  let cleanupComplete=await waitOwnedExit(browserOwner);
  for(let retry=1;!cleanupComplete&&retry<=3;retry++){
    console.log(`ATTENTE fermeture du navigateur de ${item.system} ; recuperation automatique ${retry}/3.`);
    append(c,{event:'cleanup-retry',token,retry});
    cleanupActions.push(await killOwned(browserOwner));
    cleanupComplete=await waitOwnedExit(browserOwner,15000);
  }
  if(c.diagnostics?.forceCleanupPauseOnce&&!fs.existsSync(path.join(c.stateDir,'diagnostic-cleanup-once.json'))){
    atomic(path.join(c.stateDir,'diagnostic-cleanup-once.json'),{injected:true,actualProcessGone:cleanupComplete,token});
    cleanupActions.push({controlledFault:'Pause de nettoyage injectee une fois pour verifier le watchdog',actualProcessGone:cleanupComplete});
    cleanupComplete=false;
  }
  atomic(path.join(out,'cleanup.json'),{complete:cleanupComplete,checked:new Date().toISOString(),workerExited:true,browserAlive:!cleanupComplete,actions:cleanupActions});
  active.delete(token);
  if(!cleanupComplete){fs.writeFileSync(marker('pause'),'Nettoyage processus non confirmé');append(c,{event:'cleanup-unconfirmed',token});}
  const tmp=path.join(c.stateDir,'tmp',token);if(cleanupComplete&&fs.existsSync(tmp))removeTemporary(c,tmp);
  append(c,{event:'end',id:item.id,attempt:number,status:result.status});
  console.log(`FIN ${item.system} ${item.name} : ${result.status}`);saveCampaign();
  if(++finishedJobs%(c.reportEveryJobs||20)===0)report(c);
}
try {
  if(command==='inventory'){await inventory(c,{systems:arg('system')?arg('system').split(','):null});report(c);}
  else {
    await recover();
    if(command==='resume')for(const m of ['pause','stop'])if(fs.existsSync(marker(m)))fs.unlinkSync(marker(m));
    if(args.includes('--inventory-first')&&!readJSON(path.join(c.stateDir,'inventory.json'))?.complete)await inventory(c);
    if(!fs.existsSync(path.join(c.stateDir,'inventory.json')))throw Error('Lancer inventory avant run.');
    const inv=readJSON(path.join(c.stateDir,'inventory.json'));
    if(!inv.complete)throw Error('Inventaire partiel : reprendre inventory avant run.');
    if(!fs.existsSync(path.join(c.appDir,'PORTAIL-MANIFEST.json')))throw Error('Site assemblé absent : voir README.');
    for(const s of ['genesis','psp'])if(c.includeSystems.includes(s)&&!c.externalSystems.includes(s)){
      const systemsSource=fs.readFileSync(path.join(c.appDir,'portables/js/systems.mjs'),'utf8');
      if(!new RegExp('^\\s*'+s+':','m').test(systemsSource))throw Error('Application sans '+s+' : fournir une copie assemblee de la version dix consoles.');
    }
    if(c.externalSystems.length)console.log('CAMPAGNES EXTERNES : '+c.externalSystems.join(', ')+' ; aucun test local sur ces consoles.');
    campaign.sessions++;saveCampaign();
    const history=attempts(c),seen=new Map();for(const a of history){const list=seen.get(a.item.id)||[];list.push(a);seen.set(a.item.id,list);}
    let queue=inv.items.filter(item=>{
      const h=seen.get(item.id)||[],last=h.at(-1);
      return !c.externalSystems.includes(item.system)&&(!last||last.result?.interrupted||(args.includes('--retry-failed')&&[STATUS.fail,STATUS.timeout].includes(last.result?.status)))&&h.length<c.maxAttempts&&(!arg('system')||item.system===arg('system'))&&(!arg('id')||item.id===arg('id'))&&(!arg('match')||(item.path+' '+item.name).toLowerCase().includes(arg('match').toLowerCase()));
    });
    // Comme le testeur PSP de Claude : petits fichiers d'abord, mais alterner les consoles
    // pour ne pas retarder PS1/N64 jusqu'après des dizaines de milliers de variantes NES.
    const buckets=c.includeSystems.map(s=>queue.filter(x=>x.system===s).sort((a,b)=>a.bytes-b.bytes||a.id.localeCompare(b.id)));
    const interleaved=[];for(let i=0;i<Math.max(0,...buckets.map(b=>b.length));i++)for(const b of buckets)if(b[i])interleaved.push(b[i]);
    queue=interleaved;
    const limit=Number(arg('limit',queue.length));if(!Number.isSafeInteger(limit)||limit<0)throw Error('limit invalide');queue=queue.slice(0,limit).reverse();
    append(c,{event:'session',queued:queue.length,concurrency:c.concurrency,mode:c.mode});
    await monitor();const interval=setInterval(()=>{monitor();if(fs.existsSync(marker('stop'))||stopping){stopping=true;for(const a of active.values()){a.reason='Arrêt demandé';a.abort();}}},c.resourcePollMs);
    try {
      while(queue.length||active.size) {
        if(stopping||fs.existsSync(marker('stop'))||fs.existsSync(marker('pause'))) {
          if(stopping||fs.existsSync(marker('stop')))for(const a of active.values()){a.reason='Arrêt demandé';a.abort();}
          if(!active.size)break;await sleep(250);continue;
        }
        const tempMiB=bytesIn(path.join(c.stateDir,'tmp'))/1048576,evidenceMiB=bytesIn(path.join(c.stateDir,'attempts'))/1048576;
        if(tempMiB>c.maxTempMiB||evidenceMiB>c.maxEvidenceMiB){fs.writeFileSync(marker('pause'),'Plafond espace disque');append(c,{event:'auto-pause-disk',tempMiB,evidenceMiB});continue;}
        const resourceOK=lastResources&&lastResources.freeMiB>=c.minFreeMemoryMiB&&(lastResources.cpuPercent===null||lastResources.cpuPercent<c.maxSystemCpuPercent);
        if(queue.length&&active.size<c.concurrency&&resourceOK) {
          const item=queue.pop(),number=(seen.get(item.id)?.length||0)+1;
          one(item,number).catch(async e=>{append(c,{event:'supervisor-error',error:e.stack});stopping=true;for(const [key,a] of active){await a.abort();active.delete(key);}});
        }else await sleep(250);
      }
    }finally{clearInterval(interval);}
    saveCampaign();report(c);
    append(c,{event:'session-ended',remaining:queue.length,paused:fs.existsSync(marker('pause')),stopped:stopping||fs.existsSync(marker('stop'))});
    console.log('Session terminée. Rapport : '+path.join(c.stateDir,'rapport.html'));
  }
}finally {
  for(const a of active.values())await a.abort();
  while(monitorBusy)await sleep(100);
  if(fs.existsSync(lock))fs.unlinkSync(lock);
}
