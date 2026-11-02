// Supervision de la campagne, sans moteur ni IA : respecter toute pause/arrêt explicite.
import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {HERE,config,readJSON,atomic,append,processInfo,killOwned,waitOwnedExit,sleep} from './lib.mjs';
import {attempts} from './report.mjs';

const args=process.argv.slice(2),i=args.indexOf('--config');
const c=config(i<0?undefined:args[i+1]);
fs.mkdirSync(c.stateDir,{recursive:true});
const lock=path.join(c.stateDir,'watchdog.lock'),old=readJSON(lock);
const live=old?await processInfo(old.pid):null;
if(live&&live.created===old.created){console.log('Le superviseur de cette campagne est deja actif.');process.exit(0);}
if(old)fs.unlinkSync(lock);
const owner=await processInfo(process.pid),fd=fs.openSync(lock,'wx');
try{fs.writeFileSync(fd,JSON.stringify(owner));}finally{fs.closeSync(fd);}
let stopping=false,child=null,crashCount=0;
for(const signal of ['SIGINT','SIGTERM','SIGBREAK'])process.on(signal,()=>{stopping=true;fs.writeFileSync(path.join(c.stateDir,'stop.flag'),'Arret demande depuis la console');});
async function clearClosingBrowsers() {
  const pending=attempts(c).filter(a=>readJSON(path.join(c.stateDir,'attempts',a.dir,'cleanup.json'))?.complete===false);
  for(const a of pending){
    const dir=path.join(c.stateDir,'attempts',a.dir),browser=readJSON(path.join(dir,'browser-owner.json'));
    if(!browser)return false;
    console.log('RECUPERATION : verification du navigateur ferme, aucun jeu termine ne sera rejoue.');
    let gone=await waitOwnedExit(browser,1000),actions=[];
    for(let retry=0;!gone&&!stopping&&retry<4;retry++){
      actions.push(await killOwned(browser));gone=await waitOwnedExit(browser,15000);
    }
    if(!gone)return false;
    const previous=readJSON(path.join(dir,'cleanup.json'));
    atomic(path.join(dir,'cleanup.json'),{...previous,complete:true,browserAlive:false,recoveredByWatchdog:new Date().toISOString(),recoveryActions:actions});
    append(c,{event:'watchdog-cleanup-recovered',token:a.token});
  }
  return true;
}
try{
  const startupRunner=readJSON(path.join(c.stateDir,'runner.lock'));
  const startupLive=startupRunner?await processInfo(startupRunner.pid):null;
  if(startupLive&&startupLive.created===startupRunner.created){console.log('Une campagne est deja active ; aucun deuxieme lancement.');stopping=true;}
  // Une demande explicite de relance depuis ce lanceur retire les anciennes pauses/arrêts.
  // Les drapeaux posés PENDANT son exécution sont respectés ci-dessous.
  if(!stopping)for(const name of ['pause.flag','stop.flag'])if(fs.existsSync(path.join(c.stateDir,name)))fs.unlinkSync(path.join(c.stateDir,name));
  while(!stopping){
    if(fs.existsSync(path.join(c.stateDir,'stop.flag')))break;
    const runner=readJSON(path.join(c.stateDir,'runner.lock'));
    const active=runner?await processInfo(runner.pid):null;
    if(active&&active.created===runner.created){console.log('Une campagne est deja active ; aucun deuxieme lancement.');break;}
    const started=Date.now();
    const eventsFile=path.join(c.stateDir,'events.ndjson'),eventsOffset=fs.existsSync(eventsFile)?fs.statSync(eventsFile).size:0;
    child=spawn(process.execPath,[path.join(HERE,'cli.mjs'),'resume','--inventory-first','--config',c.filename],{windowsHide:true,stdio:'inherit'});
    const exit=await new Promise(resolve=>{child.on('error',e=>resolve({code:1,error:e.message}));child.on('exit',(code,signal)=>resolve({code,signal}));});
    child=null;
    append(c,{event:'watchdog-session-exit',...exit});
    if(stopping||fs.existsSync(path.join(c.stateDir,'stop.flag')))break;
    const pause=path.join(c.stateDir,'pause.flag');
    if(fs.existsSync(pause)){
      if(fs.readFileSync(pause,'utf8').trim()!=='Nettoyage processus non confirmé'){console.log('PAUSE demandee : aucune relance automatique.');break;}
      if(!await clearClosingBrowsers()){console.error('ARRET DE SECURITE : un processus propre au banc reste actif apres les tentatives de fermeture.');break;}
      // Ne pas effacer une demande utilisateur arrivée pendant la récupération.
      if(stopping||fs.existsSync(path.join(c.stateDir,'stop.flag')))break;
      if(fs.readFileSync(pause,'utf8').trim()!=='Nettoyage processus non confirmé')break;
      fs.unlinkSync(pause);console.log('RECUPERATION REUSSIE : reprise de la file restante.');continue;
    }
    if(exit.code===0)break; // File terminée ou pause volontaire, jamais relancée en boucle.
    const events=fs.existsSync(eventsFile)?fs.readFileSync(eventsFile).subarray(eventsOffset).toString('utf8'):'';
    const progressed=events.split('\n').some(line=>{try{const e=JSON.parse(line);return e.event==='end'&&e.status!=='NON TESTÉ';}catch{return false;}});
    if(progressed)crashCount=0;
    if(++crashCount>3){console.error('Trois reprises sans progres ont echoue. Journaux conserves.');break;}
    append(c,{event:'watchdog-retry',attempt:crashCount});
    console.log(`Incident du testeur : reprise automatique ${crashCount}/3 dans 10 secondes.`);
    for(let n=0;n<20&&!stopping;n++){if(fs.existsSync(path.join(c.stateDir,'pause.flag'))||fs.existsSync(path.join(c.stateDir,'stop.flag'))){stopping=true;break;}await sleep(500);}
  }
}finally{
  if(child){fs.writeFileSync(path.join(c.stateDir,'stop.flag'),'Arret du superviseur');}
  if(fs.existsSync(lock))fs.unlinkSync(lock);
}
