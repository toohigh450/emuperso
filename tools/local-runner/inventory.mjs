import fs from 'node:fs';
import path from 'node:path';
import {EXT,ext,hash,readJSON,atomic,stamp,runFile,parse7z,safeEntry,append,STATUS} from './lib.mjs';

async function* walk(dir,warnings) {
  try {const s=fs.lstatSync(dir);if(s.isSymbolicLink())return;if(s.isFile()){yield dir;return;}}catch(e){warnings.push({path:dir,error:e.code});return;}
  let entries; try {entries=fs.readdirSync(dir,{withFileTypes:true});} catch(e){warnings.push({path:dir,error:e.code});return;}
  for(const e of entries.sort((a,b)=>a.name.localeCompare(b.name))) {
    if(e.isSymbolicLink())continue;
    const p=path.join(dir,e.name);
    if(e.isDirectory()) {if(!/^(?:images|videos|cheats.*|utilities|\.git|node_modules)$/i.test(e.name))yield*walk(p,warnings);}
    else if(e.isFile())yield p;
  }
}
export async function inventory(c) {
  fs.mkdirSync(c.stateDir,{recursive:true});
  const manifestPath=path.join(c.stateDir,'inventory.json');
  const previous=readJSON(manifestPath,{items:[],archiveCache:{}});
  const items=[],warnings=[],seen=new Set();
  let count=0;
  const save=complete=>atomic(manifestPath,{version:1,complete,updated:new Date().toISOString(),items,warnings});
  function add(s,p,st,entry=null,size=st.size,note=null) {
    const key=JSON.stringify([s,path.resolve(p).toLowerCase(),st.size,st.mtimeMs,entry]);
    if(seen.has(key))return;seen.add(key);
    items.push({id:hash(key).slice(0,32),system:s,path:p,entry,bytes:size,original:st,name:entry?path.basename(entry.replaceAll('\\','/')):path.basename(p),note,status:STATUS.untested});
  }
  for(const s of c.includeSystems) for(const root of c.roots[s]||[]) for await(const p of walk(root,warnings)) {
    const extension=ext(p),st=stamp(p);
    if(EXT[s].includes(extension)) add(s,p,st);
    else if(['zip','7z','rar'].includes(extension)) {
      // PS1 : conserver l'archive avec ses CUE et pistes liées pour le chargeur existant.
      if(s==='ps1') add(s,p,st,null,st.size,'Archive disque laissée intacte ; contenus/éditions internes non séparés.');
      else {
        const k=hash(JSON.stringify([p,st]));
        const cacheFile=path.join(c.stateDir,'inventory-cache',k+'.json');
        let entries=readJSON(cacheFile);
        if(!entries) try {
          entries=parse7z(await runFile(c.sevenZip,['l','-slt','-sccUTF-8','--',p],{timeout:60000}));
          // Le cache est persistant après CHAQUE archive, même au milieu d'un inventaire interrompu.
          atomic(cacheFile,entries);
        } catch(e) {warnings.push({path:p,error:e.message});}
        for(const e of entries||[]) if(EXT[s].includes(ext(e.Path))) {
          if(safeEntry(e.Path)&&Number.isSafeInteger(Number(e.Size)))add(s,p,st,e.Path,Number(e.Size));
          else warnings.push({path:p,entry:e.Path,error:'Entrée non sûre ou taille invalide'});
        }
      }
    } else if(s==='ps1'&&extension==='cue') warnings.push({path:p,error:'CUE seul refusé par le lanceur : utiliser une archive avec toutes les pistes ; BIN recensé séparément sans garantie multipiste.'});
    if(++count%100===0){save(false);console.log(`Inventaire : ${count} fichiers visités, ${items.length} entrées.`);}
  }
  save(true);append(c,{event:'inventory',count:items.length,warnings:warnings.length});
  return {items,warnings};
}
