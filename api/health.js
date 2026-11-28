import { db, init } from '../lib/pg-store.js';

// GET /api/health — checks the database connection and reports the Blob migration status.
export default async function handler(req, res) {
  const out = { database: null, measurements: null, rolls: null, blobMigration: null };
  try {
    const sql = db();
    await init(sql);
    const [c] = await sql`select (select count(*) from dice_measurements) as m, (select count(*) from dice_rolls) as r`;
    const [meta] = await sql`select value from dice_meta where key = 'blob_migrated'`;
    out.database = 'ok';
    out.measurements = Number(c.m);
    out.rolls = Number(c.r);
    out.blobMigration = meta ? JSON.parse(meta.value) : 'not done yet (Blob store unreachable or not yet attempted)';
  } catch (e) {
    out.database = `error: ${e?.message || e}`;
  }
  res.setHeader('content-type', 'application/json');
  res.setHeader('cache-control', 'no-store');
  res.end(JSON.stringify(out, null, 2));
}
