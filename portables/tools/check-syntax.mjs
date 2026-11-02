import {readdirSync,readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {Script} from 'node:vm';
for(const file of readdirSync('js').filter(file=>file.endsWith('.mjs'))) {
  const result=spawnSync(process.execPath,['--check',`js/${file}`],{stdio:'inherit'});
  if(result.status!==0)process.exit(result.status||1);
}
const html=readFileSync('player.html','utf8');
for(const match of html.matchAll(/<script>([\s\S]*?)<\/script>/g))new Script(match[1],{filename:'player.html'});
console.log('PASS : syntaxe des modules et du script player.html.');
