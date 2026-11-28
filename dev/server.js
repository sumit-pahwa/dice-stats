// Local dev server: serves public/ and the API using a file-based store
// (./.data) instead of Vercel Blob. No dependencies needed.
//   node dev/server.js   ->  http://localhost:3000
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeStore } from '../lib/store.js';
import { measurementsHandler, measurementHandler } from '../lib/handlers.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = path.join(root, '.data');
await fs.mkdir(dataDir, { recursive: true });

const fileAdapter = {
  async readAll() {
    const files = (await fs.readdir(dataDir)).filter((f) => f.endsWith('.json'));
    return Promise.all(files.map(async (f) => JSON.parse(await fs.readFile(path.join(dataDir, f), 'utf8'))));
  },
  async read(id) {
    try { return JSON.parse(await fs.readFile(path.join(dataDir, `${id}.json`), 'utf8')); }
    catch { return null; }
  },
  async write(m) { await fs.writeFile(path.join(dataDir, `${m.id}.json`), JSON.stringify(m)); },
  async remove(id) { await fs.rm(path.join(dataDir, `${id}.json`), { force: true }); },
};

// Use Postgres when POSTGRES_URL is set (e.g. after `vercel env pull`), otherwise local files.
const store = process.env.POSTGRES_URL
  ? (await import('../lib/pg-store.js')).makePgStore()
  : makeStore(fileAdapter);
const listH = measurementsHandler(store);
const oneH = measurementHandler(store);
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json', '.webmanifest': 'application/manifest+json' };

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  req.query = Object.fromEntries(url.searchParams);
  if (url.pathname.startsWith('/api/')) {
    let raw = '';
    for await (const c of req) raw += c;
    req.body = raw ? JSON.parse(raw) : {};
    if (url.pathname === '/api/measurements') return listH(req, res);
    if (url.pathname === '/api/measurement') return oneH(req, res);
    res.statusCode = 404; return res.end();
  }
  const file = path.join(root, 'public', url.pathname === '/' ? 'index.html' : url.pathname);
  try {
    const data = await fs.readFile(file);
    res.setHeader('content-type', types[path.extname(file)] || 'application/octet-stream');
    res.end(data);
  } catch { res.statusCode = 404; res.end('not found'); }
}).listen(process.env.PORT || 3000, () => console.log(`http://localhost:${process.env.PORT || 3000}`));
