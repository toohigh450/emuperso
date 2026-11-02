// Vérification locale uniquement : aucun téléchargement ni extraction implicite.
import {createHash} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
const lock=JSON.parse(await readFile(new URL('../emulatorjs/engine-lock.json',import.meta.url),'utf8'));
async function sha256(path) {
  const hash=createHash('sha256');
  for await(const chunk of createReadStream(path))hash.update(chunk);
  return hash.digest('hex');
}
const [mode,path]=process.argv.slice(2);
if(!path||!['--archive','--frontend'].includes(mode))throw new Error('Usage : node tools/verify-engine.mjs --archive chemin/4.2.3.7z OU --frontend chemin/data');
if(mode==='--archive') {
  if(await sha256(path)!==lock.releaseArchive.sha256)throw new Error('Archive différente de la référence GitHub. Ne pas installer.');
  console.log('PASS : SHA-256 de l’archive 4.2.3.7z conforme. Les licences et le contenu extrait restent à examiner.');
} else {
  for(const file of lock.files)if(await sha256(resolve(path,file.path))!==file.sha256)throw new Error(`Intégrité refusée : ${file.path}`);
  console.log(`PASS : ${lock.files.length} fichiers frontend conformes. Ce contrôle ne couvre pas les cœurs et autres sous-ressources.`);
}
