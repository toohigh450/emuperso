'use strict';
(() => {
const $=id=>document.getElementById(id), records=[], contexts=new Set();
let launched=false, romURL=null, lock=null;
const digest=async data=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',data))].map(x=>x.toString(16).padStart(2,'0')).join('');
function event(type,data={}){records.push({seq:records.length+1,utc:new Date().toISOString(),host_monotonic_ms:performance.now(),type,data});$('log').textContent=JSON.stringify(records,null,2);}
function status(message,error=false){$('status').textContent=message;$('status').classList.toggle('error',error);}
function audioStatus(){$('audio-state').textContent=[...contexts].map(c=>`${c.state}, ${c.sampleRate} Hz`).join(' ; ')||'Aucun contexte créé';$('audio').disabled=!contexts.size;}
const nativeFetch=window.fetch.bind(window);
window.fetch=(input,options)=>{if(String(input)==='https://cdn.emulatorjs.org/stable/data/version.json'){event('runtime.update_check.local');return nativeFetch('vendor/data/version.json',options);}return nativeFetch(input,options);};
const NativeAudioContext=window.AudioContext;
if(NativeAudioContext){window.AudioContext=class extends NativeAudioContext{constructor(...args){super(...args);contexts.add(this);event('audio.context.created',{sample_rate:this.sampleRate,state:this.state});this.addEventListener('statechange',()=>{audioStatus();event('audio.context.state',{state:this.state});});audioStatus();}};if(window.webkitAudioContext)window.webkitAudioContext=window.AudioContext;}
const nativeGetContext=HTMLCanvasElement.prototype.getContext;
HTMLCanvasElement.prototype.getContext=function(kind,...args){const context=nativeGetContext.call(this,kind,...args);if(context&&['webgl','webgl2','experimental-webgl'].includes(kind)){event('video.context.created',{kind});this.addEventListener('webglcontextlost',()=>event('video.context.lost'));}return context;};
for(const method of ['instantiate','instantiateStreaming']){const original=WebAssembly[method];if(original)WebAssembly[method]=async function(...args){const result=await original.apply(this,args);event('wasm.instantiated',{method,export_count:Object.keys(result.instance?.exports??result.exports??{}).length});return result;};}
window.addEventListener('error',e=>{event('browser.error',{message:e.message,stack:e.error?.stack});status('Erreur du moteur / navigateur : '+e.message,true);});
window.addEventListener('unhandledrejection',e=>{event('browser.unhandledrejection',{message:String(e.reason),stack:e.reason?.stack});status('Erreur du moteur / navigateur : '+e.reason,true);});
window.addEventListener('gamepadconnected',e=>{event('gamepad.connected',{id:e.gamepad.id,mapping:e.gamepad.mapping});$('gamepads').textContent=e.gamepad.id;});
$('audio').onclick=async()=>{try{for(const c of contexts)if(c.state==='suspended')await c.resume();audioStatus();event('audio.resume.requested');}catch(e){event('audio.resume.failed',{message:e.message});status(e.message,true);}};
$('start').onclick=async()=>{
 if(launched)return;launched=true;$('start').disabled=true;
 try{
  status('Vérification de la ROM homebrew et des dépendances locales…');
  const response=await fetch('homebrew/fallback-open/build-info.json',{cache:'no-store'});if(!response.ok)throw new Error('ROM non préparée. Exécutez la compilation décrite dans le guide.');lock=await response.json();
  const fetched=await fetch('homebrew/fallback-open/'+lock.rom.file,{cache:'no-store'});if(!fetched.ok)throw new Error('ROM homebrew compilée absente.');const bytes=await fetched.arrayBuffer(),header=new Uint8Array(bytes,0,4);
  if(header.join(',')!=='128,55,18,64')throw new Error('En-tête .z64 big-endian invalide.');
  $('rom-name').textContent=lock.rom.file;const hash=await digest(bytes);$('rom-sha').textContent=hash;event('rom.fetched',{bytes:bytes.byteLength,sha256:hash});
  if(hash!==lock.rom.sha256)throw new Error('SHA-256 ROM différent du relevé de compilation.');event('rom.validated',{name:lock.rom.file,sha256:hash,license:'MIT source; linked notices in homebrew/'});
  romURL=URL.createObjectURL(new Blob([bytes]));
  window.EJS_player='#game';window.EJS_DEBUG_XX=true;window.EJS_core='mupen64plus_next';window.EJS_gameName='DEMO N64 EMUPERSO';window.EJS_gameUrl=romURL;window.EJS_pathtodata='vendor/data/';window.EJS_startOnLoaded=true;window.EJS_language='en-US';window.EJS_Buttons={saveState:false,loadState:false,saveSavFiles:false,loadSavFiles:false,quickSave:false,quickLoad:false,netplay:false};window.EJS_threads=false;window.EJS_defaultOptions={webgl2Enabled:new URLSearchParams(location.search).has('legacy')?'disabled':'enabled',ejs_threads:'disabled','mupen64plus-cpucore':'pure_interpreter'};window.EJS_disableDatabases=true;window.EJS_disableLocalStorage=true;window.EJS_CacheLimit=0;window.EJS_volume=0.45;window.EJS_noAutoFocus=false;
  window.EJS_ready=()=>{event('engine.ready');$('engine-state').textContent='Interface EmulatorJS prête ; démarrage à confirmer par la vidéo.';};
  window.EJS_onGameStart=()=>{event('engine.start.callback');$('engine-state').textContent='Callback de lancement reçu — mupen64plus_next.';status('Moteur lancé. Vérifiez le compteur et l’animation dans la vidéo. X = A, S = B.');audioStatus();};
  window.EJS_onExit=()=>{event('engine.exit');status('Moteur quitté. Rechargez pour un nouvel essai.');};
  const script=document.createElement('script');script.src='vendor/data/loader.js';script.onerror=()=>status('Dépendances EmulatorJS absentes. Exécutez tools/fetch_runtime.py.',true);document.body.appendChild(script);event('engine.loader.requested',{core:'mupen64plus_next',threads:false});
 }catch(e){event('launch.failed',{message:e.message});status(e.message,true);}
};
$('reload').onclick=()=>{if(confirm('Recharger cet essai réel ? Aucun fichier original ne sera modifié.'))location.reload();};
function diagnostic(){return{schema:'emuperso/real-engine-diagnostic/v1',scope:'REAL_ENGINE_TRIAL_NOT_SYNTHETIC_LAB',warning:'Runtime observations do not validate Karl’s device, commercial games, Conker or Sonic.',host:{user_agent:navigator.userAgent,cross_origin_isolated:crossOriginIsolated},rom_build:lock,contexts:[...contexts].map(c=>({state:c.state,sample_rate:c.sampleRate})),records:structuredClone(records)};}
$('export').onclick=()=>{const u=URL.createObjectURL(new Blob([JSON.stringify(diagnostic(),null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=u;a.download='EMUPERSO-moteur-reel-diagnostic.json';a.click();setTimeout(()=>URL.revokeObjectURL(u),1000);};
window.RealN64=Object.freeze({diagnostic,version:'0.1.0-real-engine'});event('page.open',{engine_started:false});
})();
