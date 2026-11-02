// Sert dist/ en local avec les en-têtes de vercel.json, pour tester le portail comme sur Vercel.
//   node tools/build-portail.mjs && node tools/serve-portail.mjs [port]
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, resolve, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const DIST = resolve(ROOT, 'dist');
const config = JSON.parse(await readFile(join(ROOT, 'vercel.json'), 'utf8'));
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.wasm': 'application/wasm', '.png': 'image/png', '.svg': 'image/svg+xml',
  '.md': 'text/markdown; charset=utf-8', '.txt': 'text/plain; charset=utf-8', '.data': 'application/octet-stream',
};
const rules = config.headers.map((h) => ({ re: new RegExp(`^${h.source.replace('(.*)', '.*')}$`), headers: h.headers }));

export function startPortail(port = 0) {
  const server = createServer(async (req, res) => {
    let path = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    let file = resolve(DIST, '.' + path);
    if (!file.startsWith(DIST + sep) && file !== DIST) { res.writeHead(403).end(); return; }
    try {
      if ((await stat(file)).isDirectory()) {
        if (!path.endsWith('/')) { res.writeHead(308, { location: path + '/' }).end(); return; }
        file = join(file, 'index.html');
      }
      const body = await readFile(file);
      for (const rule of rules) if (rule.re.test(path)) for (const h of rule.headers) res.setHeader(h.key, h.value);
      res.setHeader('Content-Type', TYPES[extname(file)] || 'application/octet-stream');
      res.end(req.method === 'HEAD' ? undefined : body);
    } catch { res.writeHead(404).end('404'); }
  });
  return new Promise((ok) => server.listen(port, '127.0.0.1', () => ok({
    url: `http://127.0.0.1:${server.address().port}/`,
    close: () => new Promise((r) => server.close(r)),
  })));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const s = await startPortail(Number(process.argv[2]) || 8080);
  console.log(`Portail local : ${s.url}`);
}
