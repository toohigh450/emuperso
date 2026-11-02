import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { spawn, execFileSync } from 'node:child_process';

export const HERE = path.dirname(fileURLToPath(import.meta.url));
export const STATUS = Object.freeze({ untested:'NON TESTÉ', boot:'DÉMARRAGE', image:'IMAGE DÉTECTÉE', suspect:'SUSPECT', fail:'ÉCHEC', timeout:'BLOQUÉ / TIMEOUT', gameplay:'GAMEPLAY VALIDÉ', save:'SAUVEGARDE VALIDÉE' });
export const EXT = { nes:['nes','unf','unif'], snes:['sfc','smc','swc','fig'], gb:['gb','sgb'], gbc:['gbc'], gba:['gba'], nds:['nds','dsi','srl'], n64:['z64','n64','v64'], ps1:['iso','bin','img','chd','pbp'] };
export const ext = p => path.extname(p).slice(1).toLowerCase();
export const hash = s => createHash('sha256').update(s).digest('hex');
export const readJSON = (p, fallback) => { try { return JSON.parse(fs.readFileSync(p,'utf8').replace(/^\uFEFF/,'')); } catch(e) { if(e.code==='ENOENT') return fallback; throw e; } };
export function atomic(p, obj) {
  fs.mkdirSync(path.dirname(p),{recursive:true});
  const tmp = p+'.'+randomUUID()+'.tmp';
  const fd=fs.openSync(tmp,'wx');
  try { fs.writeFileSync(fd,JSON.stringify(obj,null,2)+'\n'); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  fs.renameSync(tmp,p);
}
export const sleep = ms => new Promise(r=>setTimeout(r,ms));
export function config(file) {
  const filename=path.resolve(file||path.join(HERE,'config.local.json'));
  const c=readJSON(filename);
  if(!c) throw Error('Configuration absente : lancez LAB.bat init, puis adaptez config.local.json.');
  const expand = v => path.resolve(path.dirname(filename),v.replace(/%([^%]+)%/g,(_,k)=>process.env[k]||''));
  for(const k of ['stateDir','appDir','chrome','sevenZip']) c[k]=expand(c[k]);
  for(const [s,roots] of Object.entries(c.roots||{})) c.roots[s]=roots.map(expand);
  c.filename=filename;
  if(!Number.isInteger(c.concurrency)||c.concurrency<1||c.concurrency>4) throw Error('concurrency doit être entre 1 et 4.');
  if(c.concurrency>1 && !c.parallelTrialAccepted) throw Error('Effectuez une petite campagne parallèle isolée et documentée avant de définir parallelTrialAccepted=true.');
  for(const k of ['timeoutMs','observationMs','deepObservationMs','maxTreeMemoryMiB','minFreeMemoryMiB','resourcePollMs','maxExtractMiB','maxTempMiB','maxEvidenceMiB','maxAttempts']) if(!Number.isFinite(c[k])||c[k]<=0) throw Error('Configuration invalide : '+k);
  if(!['short','deep'].includes(c.mode)) throw Error('mode attendu : short ou deep');
  if(!Array.isArray(c.includeSystems)||c.includeSystems.some(s=>!EXT[s])) throw Error('Console inconnue ou PSP hors périmètre.');
  // Tout stockage du banc est séparé des collections, même si la config est mal saisie.
  for(const roots of Object.values(c.roots)) for(const r of roots) if(inside(r,c.stateDir)||inside(c.stateDir,r)) throw Error('stateDir et les collections ne doivent pas se chevaucher.');
  if(inside(c.appDir,c.stateDir)||inside(c.stateDir,c.appDir)) throw Error('stateDir doit être séparé du site servi.');
  return c;
}
export function inside(root,p) { const rel=path.relative(path.resolve(root),path.resolve(p)); return rel===''||(!rel.startsWith('..'+path.sep)&&rel!=='..'&&!path.isAbsolute(rel)); }
export function append(c,event) { fs.mkdirSync(c.stateDir,{recursive:true}); fs.appendFileSync(path.join(c.stateDir,'events.ndjson'),JSON.stringify({time:new Date().toISOString(),...event})+'\n'); }
export const stamp = p => { const s=fs.statSync(p); return {size:s.size,mtimeMs:s.mtimeMs}; };
export async function fileHash(p) { const h=createHash('sha256'); for await (const b of fs.createReadStream(p)) h.update(b); return h.digest('hex'); }
export function classify(r) {
  if(r.timeout) return STATUS.timeout;
  if(r.error||r.errors?.length||r.crashed||r.originalChanged) return STATUS.fail;
  if(!r.engineStarted) return STATUS.untested;
  if(!r.after) return STATUS.boot;
  if(r.after.colors<=1||r.frameRate===null||r.frameRate<=0||r.frameRate>300) return STATUS.suspect;
  return STATUS.image; // Jamais gameplay/sauvegarde sans validation humaine indépendante.
}
export function parse7z(text) {
  const body=text.split(/^-{10,}\r?$/m).slice(1).join('\n');
  return body.split(/\r?\n\r?\n/).map(block=>Object.fromEntries(block.split(/\r?\n/).filter(x=>x.includes(' = ')).map(x=>{const i=x.indexOf(' = ');return [x.slice(0,i),x.slice(i+3)];}))).filter(e=>e.Path&&e.Folder!=='+'&&!e.Attributes?.startsWith('D'));
}
export function safeEntry(p) { return p && !/[\x00-\x1f*?]/.test(p) && !/^(?:[a-z]:|[\\/]|-|@)/i.test(p) && !p.split(/[\\/]/).includes('..'); }
export function runFile(command,args,opts={}) {
  return new Promise((resolve,reject)=>{
    const child=spawn(command,args,{windowsHide:true,...opts});
    let stdout='',stderr='';
    const max=opts.maxOutput||32*1024*1024;
    child.stdout?.on('data',b=>{stdout+=b;if(stdout.length>max){child.kill();reject(Error('Sortie trop volumineuse'));}});
    child.stderr?.on('data',b=>{stderr=(stderr+b).slice(-8192);});
    const timer=setTimeout(()=>{child.kill();reject(Error('Délai commande : '+command));},opts.timeout||30000);
    child.on('error',e=>{clearTimeout(timer);reject(e);});
    child.on('close',code=>{clearTimeout(timer);if(code===0)resolve(stdout);else reject(Error(`${command}: code ${code}: ${stderr}`));});
  });
}
export async function processInfo(pid) {
  if(process.platform!=='win32') return null;
  const script=`$p=Get-CimInstance Win32_Process -Filter 'ProcessId = ${Number(pid)}'; if($p){[pscustomobject]@{pid=$p.ProcessId;created=$p.CreationDate.ToUniversalTime().ToString('o');command=$p.CommandLine}|ConvertTo-Json -Compress}`;
  const s=await runFile('powershell.exe',['-NoProfile','-NonInteractive','-Command',script],{timeout:15000});
  return s.trim()?JSON.parse(s):null;
}
export function sameOwnedProcess(record,live) {
  return !!(record&&live&&record.pid===live.pid&&record.created===live.created&&record.token&&record.command?.includes(record.token)&&(!live.command||live.command.includes(record.token)));
}
export async function killOwned(record) {
  if(!record?.pid) return;
  if(process.platform==='win32') {
    const live=await processInfo(record.pid);
    if(!sameOwnedProcess(record,live)) return {action:'not-live-or-not-owned'};
    const outcome={action:'terminate-owned',pid:record.pid,commandUnavailable:!live.command};
    try{outcome.output=await runFile('taskkill.exe',['/PID',String(record.pid),'/T','/F'],{timeout:15000});}catch(e){outcome.error=e.message;}
    // Le processus parent peut déjà être mort ; /T échoue alors parfois sur cet arbre.
    // Revalider l'identité avant un repli direct sur CE PID uniquement.
    if(outcome.error&&sameOwnedProcess(record,await processInfo(record.pid)))try{
      outcome.fallback=await runFile('powershell.exe',['-NoProfile','-NonInteractive','-Command',`Stop-Process -Id ${Number(record.pid)} -Force -ErrorAction Stop`],{timeout:10000});
    }catch(e){outcome.fallbackError=e.message;}
    await runFile('powershell.exe',['-NoProfile','-NonInteractive','-Command',`$p=Get-Process -Id ${Number(record.pid)} -ErrorAction SilentlyContinue; if($p){$p|Wait-Process -Timeout 5 -ErrorAction SilentlyContinue}`],{timeout:10000}).catch(()=>{});
    return outcome;
  } else { try {process.kill(record.pid,'SIGTERM');} catch {} }
}
export async function waitOwnedExit(record, timeoutMs=10000) {
  if(!record)return true;
  const deadline=Date.now()+timeoutMs;
  do {
    const live=await processInfo(record.pid);
    if(!live||live.created!==record.created)return true;
    await sleep(300);
  }while(Date.now()<deadline);
  return false;
}
export async function resourceSample(workerPids=[]) {
  if(process.platform!=='win32') return {freeMiB:os.freemem()/1048576,totalMiB:os.totalmem()/1048576,cpuPercent:null,processes:[]};
  const pids=workerPids.map(Number).join(',');
  const script=`$ErrorActionPreference='Stop'; $os=Get-CimInstance Win32_OperatingSystem; $cpu=Get-CimInstance Win32_Processor; $all=@(Get-CimInstance Win32_Process); $ids=@(${pids}); do {$n=$ids.Count; foreach($p in $all){if($ids -contains [int]$p.ParentProcessId -and $ids -notcontains [int]$p.ProcessId){$ids+= [int]$p.ProcessId}}}while($ids.Count -gt $n); $rows=@($all|Where-Object{$ids -contains [int]$_.ProcessId}|ForEach-Object{[pscustomobject]@{pid=$_.ProcessId;parent=$_.ParentProcessId;name=$_.Name;rssMiB=[math]::Round([double]$_.WorkingSetSize/1MB,2)}}); [pscustomobject]@{freeMiB=[double]$os.FreePhysicalMemory/1024;totalMiB=[double]$os.TotalVisibleMemorySize/1024;cpuPercent=($cpu|Measure-Object LoadPercentage -Average).Average;processes=$rows}|ConvertTo-Json -Compress -Depth 4`;
  return JSON.parse(await runFile('powershell.exe',['-NoProfile','-NonInteractive','-Command',script],{timeout:20000}));
}
export function bytesIn(dir) {
  let n=0,entries;try{entries=fs.readdirSync(dir,{withFileTypes:true});}catch(e){if(e.code==='ENOENT')return 0;throw e;}
  for(const e of entries){if(e.isSymbolicLink())continue;const p=path.join(dir,e.name);try{n+=e.isDirectory()?bytesIn(p):fs.statSync(p).size;}catch(err){if(err.code!=='ENOENT')throw err;}}
  return n;
}
export function removeTemporary(c,p) {
  const base=path.join(c.stateDir,'tmp');
  if(!inside(base,p)||path.resolve(base)===path.resolve(p)||fs.lstatSync(p).isSymbolicLink()) throw Error('Nettoyage hors dossier temporaire refusé.');
  fs.rmSync(p,{recursive:true,force:true});
}
