// Vercel Blob storage adapter.
//
// Each measurement is one JSON document. Every save writes a NEW blob
// (m/<id>/<timestamp>-<random>.json) and then deletes the older versions.
// Reads use list() (always fresh) and fetch the newest blob by its unique URL,
// so caches can never serve a stale copy after an edit.
//
// Auth: no token is passed — the SDK picks credentials itself (OIDC via
// BLOB_STORE_ID on Vercel, or BLOB_READ_WRITE_TOKEN as a fallback).
// Works with both private and public stores.

import * as blob from '@vercel/blob';
import { HttpError } from './store.js';

const ROOT = 'm/';

// Store access mode: from env, otherwise detected on first write.
let access = ['private', 'public'].includes(process.env.BLOB_ACCESS) ? process.env.BLOB_ACCESS : null;

function friendly(e) {
  const msg = String(e?.message || e);
  if (/no token|token.*(found|provided|missing)|credentials/i.test(msg)) {
    return new HttpError(500, `Blob store auth failed (${msg}). Make sure the store is connected to this project for Production, then redeploy.`);
  }
  return e;
}

async function listAll(prefix) {
  const out = [];
  let cursor;
  do {
    const r = await blob.list({ prefix, cursor, limit: 1000 }).catch((e) => { throw friendly(e); });
    out.push(...r.blobs);
    cursor = r.hasMore ? r.cursor : undefined;
  } while (cursor);
  return out;
}

const isPrivateUrl = (url) => /\.private\.blob\./.test(url);

async function readJson(url) {
  if (isPrivateUrl(url)) {
    const r = await blob.get(url, { access: 'private', useCache: false });
    if (!r || r.statusCode !== 200) throw new Error('Blob read failed');
    return JSON.parse(await new Response(r.stream).text());
  }
  const r = await fetch(url, { cache: 'no-store' });
  if (!r.ok) throw new Error(`Blob read failed: HTTP ${r.status}`);
  return r.json();
}

async function putJson(pathname, data) {
  const opts = (a) => ({ access: a, addRandomSuffix: true, contentType: 'application/json' });
  if (access) return blob.put(pathname, data, opts(access)).catch((e) => { throw friendly(e); });
  try {
    const res = await blob.put(pathname, data, opts('private'));
    access = 'private';
    return res;
  } catch (e) {
    // Public stores reject private uploads (and vice versa); try the other mode.
    const res = await blob.put(pathname, data, opts('public')).catch(() => { throw friendly(e); });
    access = 'public';
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
    return Promise.all([...groups.values()].map((g) => readJson(g[0].url)));
  },

  async read(id) {
    const blobs = (await listAll(`${ROOT}${id}/`)).sort(byNewest);
    if (!blobs.length) return null;
    return readJson(blobs[0].url);
  },

  async write(m) {
    const stamp = String(Date.now()).padStart(15, '0');
    const saved = await putJson(`${ROOT}${m.id}/${stamp}.json`, JSON.stringify(m));
    // prune older versions (best effort)
    const old = (await listAll(`${ROOT}${m.id}/`)).filter((b) => b.url !== saved.url && b.pathname < saved.pathname);
    if (old.length) await blob.del(old.map((b) => b.url)).catch(() => {});
  },

  async remove(id) {
    const blobs = await listAll(`${ROOT}${id}/`);
    if (blobs.length) await blob.del(blobs.map((b) => b.url));
  },
};
