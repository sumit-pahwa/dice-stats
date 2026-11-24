import { list } from '@vercel/blob';

// GET /api/health — quick check that the Blob store is connected and reachable.
// Reports only whether credentials exist, never their values.
export default async function handler(req, res) {
  const out = {
    blobStoreId: Boolean(process.env.BLOB_STORE_ID || Object.keys(process.env).some((k) => k.endsWith('_STORE_ID'))),
    readWriteToken: Boolean(Object.keys(process.env).some((k) => k.endsWith('READ_WRITE_TOKEN'))),
    accessSetting: process.env.BLOB_ACCESS || '(auto)',
    blobList: null,
  };
  try {
    const r = await list({ prefix: 'm/', limit: 5 });
    out.blobList = `ok (${r.blobs.length} blobs sampled)`;
  } catch (e) {
    out.blobList = `error: ${e?.message || e}`;
  }
  res.setHeader('content-type', 'application/json');
  res.setHeader('cache-control', 'no-store');
  res.end(JSON.stringify(out, null, 2));
}
