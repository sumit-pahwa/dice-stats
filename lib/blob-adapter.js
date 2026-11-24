// Vercel Blob storage adapter.
//
// Each measurement is one JSON document. Every save writes a NEW blob
// (m/<id>/<timestamp>-<random>.json) and then deletes the older versions.
// Reads use list() (always fresh) and fetch the newest blob by its unique URL,
// so the Blob CDN cache can never serve a stale copy after an edit.

import { put, list, del } from '@vercel/blob';

const ACCESS = process.env.BLOB_ACCESS === 'private' ? 'private' : 'public';
const ROOT = 'm/';

async function listAll(prefix) {
  const out = [];
  let cursor;
  do {
    const r = await list({ prefix, cursor, limit: 1000 });
    out.push(...r.blobs);
    cursor = r.hasMore ? r.cursor : undefined;
  } while (cursor);
  return out;
}

async function fetchJson(url) {
  const headers = {};
  if (ACCESS === 'private') headers.authorization = `Bearer ${process.env.BLOB_READ_WRITE_TOKEN}`;
  const r = await fetch(url, { headers, cache: 'no-store' });
  if (!r.ok) throw new Error(`Blob fetch failed: ${r.status}`);
  return r.json();
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
    const saved = await put(`${ROOT}${m.id}/${stamp}.json`, JSON.stringify(m), {
      access: ACCESS,
      addRandomSuffix: true,
      contentType: 'application/json',
    });
    // prune older versions (best effort)
    const old = (await listAll(`${ROOT}${m.id}/`)).filter((b) => b.url !== saved.url && b.pathname < saved.pathname);
    if (old.length) await del(old.map((b) => b.url)).catch(() => {});
  },

  async remove(id) {
    const blobs = await listAll(`${ROOT}${id}/`);
    if (blobs.length) await del(blobs.map((b) => b.url));
  },
};
