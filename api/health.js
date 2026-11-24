import { list } from '@vercel/blob';

// GET /api/health — quick check that the Blob store is connected and reachable.
export default async function handler(req, res) {
  const tokenKey = process.env.BLOB_READ_WRITE_TOKEN
    ? 'BLOB_READ_WRITE_TOKEN'
    : Object.keys(process.env).find((k) => k.endsWith('_READ_WRITE_TOKEN')) || null;
  const out = { tokenFound: tokenKey, accessSetting: process.env.BLOB_ACCESS || '(auto)', blobList: null };
  if (tokenKey) {
    try {
      const r = await list({ prefix: 'm/', limit: 5, token: process.env[tokenKey] });
      out.blobList = `ok (${r.blobs.length} blobs sampled)`;
    } catch (e) {
      out.blobList = `error: ${e?.message || e}`;
    }
  }
  res.setHeader('content-type', 'application/json');
  res.setHeader('cache-control', 'no-store');
  res.end(JSON.stringify(out, null, 2));
}
