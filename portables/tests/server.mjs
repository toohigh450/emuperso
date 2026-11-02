import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
export async function startTestServer() {
  const root = fileURLToPath(new URL('../',import.meta.url));
  const server = createServer(async(req,res)=>{
    const path=resolve(root,'.'+new URL(req.url,'http://localhost').pathname.replace(/\/$/,'/index.html'));
    if(!path.startsWith(root.endsWith(sep)?root:root+sep)){res.writeHead(403).end();return;}
    try {
      const body=await readFile(path);
      res.setHeader('Content-Type',({'.html':'text/html','.mjs':'text/javascript','.css':'text/css','.json':'application/json'})[extname(path)]||'application/octet-stream');
      res.end(body);
    } catch {res.writeHead(404).end();}
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  return {url:`http://127.0.0.1:${server.address().port}/`,close:()=>new Promise(r=>server.close(r))};
}
