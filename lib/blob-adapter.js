// Vercel Blob storage adapter.
//
// Each measurement is one JSON document. Every save writes a NEW blob
// (m/<id>/<timestamp>-<random>.json) and then deletes the older versions.
// Reads use list() (always fresh) and fetch the newest blob by its unique URL,
// so the Blob CDN cache can never serve a stale copy after an edit.

import { put, list, del } from '@vercel/blob';
import { HttpError } from './store.js';

const ROOT = 'm/';

// Vercel names the token BLOB_READ_WRITE_TOKEN by default, or
// <PREFIX>_READ_WRITE_TOKEN if a custom prefix was chosen when connecting.
function token() {
  if (process.env.BLOB_READ_WRITE_TOKEN) return process.env.BLOB_READ_WRITE_TOKEN;
  const key = Object.keys(process.env).find((k) => k.endsWith('_READ_WRITE_TOKEN'));
  if (key) return process.env[key];
  throw new HttpError(
    500,
    'Blob store not connected (no BLOB_READ_WRITE_TOKEN). In Vercel: Storage → Blob → Connect to this project, then redeploy.'
  );
}

// Store access mode: from env, otherwise detected on first write.
let access = process.env.BLOB_ACCESS === 'private' ? 'private' : process.env.BLOB_ACCESS === 'public' ? 'public' : null;

async function listAll(prefix) {
  const out = [];
  let cursor;
  do {
    const r = await list({ prefix, cursor, limit: 1000, token: token() });
    out.push(...r.blobs);
    cursor = r.hasMore ? r.cursor : undefined;
  } while (cursor);
  return out;
}

async function fetchJson(url) {
  // Send the token only to the Blob store's own host (needed for private stores).
  const headers = /\.blob\.vercel-storage\.com$/.test(new URL(url).hostname)
    ? { authorization: `Bearer ${token()}` }
    : {};
  let r = await fetch(url, { headers, cache: 'no-store' });
  if (!r.ok && headers.authorization) r = await fetch(url, { cache: 'no-store' });
  if (!r.ok) throw new Error(`Blob read failed: HTTP ${r.status}`);
  return r.json();
}

async function putJson(pathname, data) {
  const opts = (a) => ({ access: a, addRandomSuffix: true, contentType: 'application/json', token: token() });
  if (access) return put(pathname, data, opts(access));
  try {
    const res = await put(pathname, data, opts('public'));
    access = 'public';
    return res;
  } catch (e) {
    // Private stores reject public uploads; retry as private.
    const res = await put(pathname, data, opts('private')).catch(() => { throw e; });
    access = 'private';
    return res;
  }
}

// newest first
const byNewest = (a, b) => b.pathname.localeCompare(a.pathname);

function groupById(blobs) {
  const groups = new Map();
  for (const b of blobs) {
    const id = b.pathname.slice(ROOT.length).split('/')[0];
    if (!groups.has(id)) groups.set(id, []);
    groups.get(id).push(b);
  }
  for (const g of groups.values()) g.sort(byNewest);
  return groups;
}

export const blobAdapter = {
  async readAll() {
    const groups = groupById(await listAll(ROOT));
    return Promise.all([...groups.values()].map((g) => fetchJson(g[0].url)));
  },

  async read(id) {
    const blobs = (await listAll(`${ROOT}${id}/`)).sort(byNewest);
    if (!blobs.length) return null;
    return fetchJson(blobs[0].url);
  },

  async write(m) {
    const stamp = String(Date.now()).padStart(15, '0');
    const saved = await putJson(`${ROOT}${m.id}/${stamp}.json`, JSON.stringify(m));
    // prune older versions (best effort)
    const old = (await listAll(`${ROOT}${m.id}/`)).filter((b) => b.url !== saved.url && b.pathname < saved.pathname);
    if (old.length) await del(old.map((b) => b.url), { token: token() }).catch(() => {});
  },

  async remove(id) {
    const blobs = await listAll(`${ROOT}${id}/`);
    if (blobs.length) await del(blobs.map((b) => b.url), { token: token() });
  },
};
