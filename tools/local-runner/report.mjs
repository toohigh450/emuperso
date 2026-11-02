import fs from 'node:fs';
import path from 'node:path';
import {readJSON,atomic,STATUS} from './lib.mjs';
const esc=v=>String(v??'').replace(/[&<>"']/g,x=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[x]));
export function attempts(c) {
  const root=path.join(c.stateDir,'attempts'),a=[];
  if(!fs.existsSync(root))return a;
  for(const dir of fs.readdirSync(root)) {
    const p=path.join(root,dir);if(!fs.statSync(p).isDirectory())continue;
    const job=readJSON(path.join(p,'job.json'));if(!job)continue;
    a.push({dir,...job,result:readJSON(path.join(p,'result.json'))});
  }
  return a.sort((a,b)=>a.attempt-b.attempt||a.dir.localeCompare(b.dir));
}
export function report(c) {
  const inv=readJSON(path.join(c.stateDir,'inventory.json'),{items:[],warnings:[],complete:false}),all=attempts(c),byID=new Map();
  for(const a of all) {const prev=byID.get(a.item.id);if(!prev||a.attempt>=prev.attempt)byID.set(a.item.id,a);}
  const rows=inv.items.map(item=>{const a=byID.get(item.id);return {item,attempt:a?.attempt||0,dir:a?.dir,result:a?.result||null,status:a?.result?.status||STATUS.untested};});
  const counts=Object.fromEntries(Object.values(STATUS).map(x=>[x,0]));for(const r of rows)counts[r.status]=(counts[r.status]||0)+1;
  const done=rows.filter(r=>r.result&&!r.result.interrupted).length,activeMs=readJSON(path.join(c.stateDir,'campaign.json'),{}).activeMs||0;
  let pendingShown=0;
  const displayRows=rows.filter(r=>r.result||pendingShown++<100);
  const elapsed=all.filter(a=>a.result&&!a.result.interrupted).reduce((n,a)=>n+(a.result.elapsedMs||0),0);
  const output={version:1,generated:new Date().toISOString(),inventoryComplete:inv.complete,total:rows.length,tested:done,remaining:rows.length-done,counts,activeMs,measuredTestSeconds:elapsed/1000,completedPerActiveHour:activeMs?done/(activeMs/3600000):null,rows,inventoryWarnings:inv.warnings};
  atomic(path.join(c.stateDir,'results.json'),output);
  const csvCell=x=>'"'+String(x??'').replaceAll('"','""')+'"';
  const csv=[['id','console','nom','archive_entry','statut','tentative','durée_ms','compteur_par_seconde','image_modifiée','erreur'],...rows.map(({item,status,attempt,result:r})=>[item.id,item.system,item.name,item.entry,status,attempt,r?.elapsedMs,r?.frameRate,r?.imageChanged,r?.error||r?.interruptionReason])].map(row=>row.map(csvCell).join(';')).join('\r\n');
  // Éviter les formules Excel lors de l'ouverture d'un nom de ROM non fiable.
  fs.writeFileSync(path.join(c.stateDir,'results.csv'),'\uFEFF'+csv.replace(/"([=+@-])/g,'"\'$1'));
  const consoles=Object.keys(c.roots).map(s=>`<tr><td>${esc(s)}</td><td>${rows.filter(r=>r.item.system===s).length}</td><td>${rows.filter(r=>r.item.system===s&&r.result&&!r.result.interrupted).length}</td></tr>`).join('');
  const html=`<!doctype html><html lang="fr"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>EMUPERSO — campagne locale</title><style>
  :root{color-scheme:dark}body{font:16px/1.6 system-ui;background:#101522;color:#e8edf9;max-width:1250px;margin:auto;padding:28px;overflow-wrap:anywhere}h1{line-height:1.2}small,.muted{color:#abb9d1}a{color:#8dd7ff}.metrics{display:flex;gap:16px;flex-wrap:wrap}.metrics p,details,.panel{background:#1b2336;border:1px solid #36435e;border-radius:12px;padding:16px}.metrics b{display:block;font-size:30px}table{border-collapse:collapse;width:100%}td,th{text-align:left;border-bottom:1px solid #38435d;padding:8px;overflow-wrap:anywhere}input,select{font:inherit;padding:9px;margin:6px;background:#1b2336;color:inherit;max-width:90%}summary{cursor:pointer;font-weight:650}pre{white-space:pre-wrap;overflow-wrap:anywhere;font-size:12px}img{max-width:100%;height:auto;border-radius:6px}figure{display:inline-block;vertical-align:top;width:min(42%,440px);margin:12px}code{overflow-wrap:anywhere}@media(max-width:650px){body{padding:14px}figure{width:100%;margin:8px 0}}.flag{color:#ffd58a}details[data-status="ÉCHEC"] summary{color:#ffaaa8}</style>
  <h1>EMUPERSO · laboratoire local</h1><p class="muted">Rapport privé hors ligne · ${esc(output.generated)} · actualiser ce fichier après <code>LAB.bat report</code>.</p>
  <div class="metrics"><p><b>${output.total}</b>entrées inventoriées</p><p><b>${done}</b>tests terminés</p><p><b>${output.remaining}</b>restants / interrompus</p><p><b>${(activeMs/3600000).toFixed(2)} h</b>temps actif mesuré</p><p><b>${output.completedPerActiveHour?.toFixed(1)||'—'}</b>tests / heure active</p></div>
  <p class="panel">Une image détectée n'est pas une validation de jouabilité. Le débit affiché mesure le compteur EmulatorJS, pas les images vidéo natives. Aucune validation automatique de gameplay, de sauvegarde native ou de save state. Le mode approfondi envoie des commandes et conserve des captures, sans transformer ces signaux en preuve de gameplay. Inventaire ${inv.complete?'terminé':'partiel : reprendre inventory'}.</p>
  <table><tr><th>Statut</th><th>Nombre</th></tr>${Object.entries(counts).map(([k,v])=>`<tr><td>${esc(k)}</td><td>${v}</td></tr>`).join('')}</table>
  <h2>Consoles</h2><table><tr><th>Console</th><th>Inventoriés</th><th>Terminés</th></tr>${consoles}</table>
  <h2>Résultats et anomalies</h2><label>Filtrer <input id="search" placeholder="jeu, console, erreur"></label><label>Statut <select id="status"><option value="">Tous</option>${Object.values(STATUS).map(s=>`<option>${esc(s)}</option>`).join('')}</select></label><p id="visible"></p>
  <p class="muted">Tous les résultats disponibles figurent ci-dessous. Pour garder la page rapide, seulement les 100 premières entrées encore sans résultat sont détaillées. Le JSON et le CSV contiennent l'inventaire intégral ; les compteurs ci-dessus portent sur toutes les entrées.</p>
  ${displayRows.map(({item,attempt,dir,result:r,status})=>`<details data-status="${esc(status)}"><summary>${esc(item.system.toUpperCase())} · ${esc(item.name)} · ${esc(status)}</summary><p>${esc(item.path)}${item.entry?' → '+esc(item.entry):''}</p><p>Tentative ${attempt} · phase ${esc(r?.phase||'attente')} · durée ${r?.elapsedMs?(r.elapsedMs/1000).toFixed(1)+' s':'—'} · compteur/s ${r?.frameRate?.toFixed(2)??'—'}</p>${r?.error||r?.interrupted||r?.timeout?`<p class="flag">${esc(r.error||r.interruptionReason||'Délai dépassé')}</p>`:''}${r?.pageStatus?`<p>${esc(r.pageStatus)}</p>`:''}${r?.originalSha256?`<p>SHA-256 source : <code>${esc(r.originalSha256)}</code><br>Vérification après essai : ${r.originalChanged?'CHANGEMENT OBSERVÉ':r.originalSha256After?'identique':'non terminée'}</p>`:''}${['before','after','afterInputs'].map(k=>r?.[k]?.image?`<figure><a href="attempts/${encodeURIComponent(dir)}/${encodeURIComponent(r[k].image)}"><img loading="lazy" src="attempts/${encodeURIComponent(dir)}/${encodeURIComponent(r[k].image)}" alt="${esc(k)}"></a><figcaption>${esc(k)} · ${r[k].colors} couleurs échantillonnées · ${esc(r[k].method)}</figcaption></figure>`:'').join('')}${dir?`<p><a href="attempts/${encodeURIComponent(dir)}/result.json">Résultat technique</a> · <a href="attempts/${encodeURIComponent(dir)}/worker.log">Journal</a></p>`:''}<pre>${esc(JSON.stringify(r?.errors||[],null,2))}</pre></details>`).join('')}
  <h2>Limites et conservation</h2><p>Les tentatives historiques restent dans attempts/, même après une reprise. Aucun résultat n'est effacé pour masquer une erreur. Les captures et les noms de fichiers sont privés : ne pas publier ce dossier. Aucun BIOS n'est fourni ou téléchargé. PS1 : archives conservées avec leurs pistes ; BIN multipiste isolé non validé. PSP exclue. Les archives Nintendo sont recensées par entrée et extraites temporairement en lecture seule de l'original. La mesure peut être influencée par la campagne PSP et la charge du PC.</p><p><a href="results.json">JSON</a> · <a href="results.csv">CSV</a> · <a href="events.ndjson">Événements</a> · <a href="resources.ndjson">CPU, RAM et processus</a></p>
  <details><summary>Avertissements d'inventaire (${inv.warnings?.length||0})</summary><pre>${esc(JSON.stringify(inv.warnings,null,2))}</pre></details>
  <script>const entries=[...document.querySelectorAll('details[data-status]')];function filter(){let n=0;for(const e of entries){e.hidden=!(e.textContent.toLocaleLowerCase().includes(document.querySelector('#search').value.toLocaleLowerCase())&&(!document.querySelector('#status').value||e.dataset.status===document.querySelector('#status').value));if(!e.hidden)n++}document.querySelector('#visible').textContent=n+' entrées affichées'}document.querySelector('#search').oninput=filter;document.querySelector('#status').onchange=filter;filter();</script></html>`;
  const dest=path.join(c.stateDir,'rapport.html'),tmp=dest+'.tmp';fs.writeFileSync(tmp,html);fs.renameSync(tmp,dest);return output;
}
