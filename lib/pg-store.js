// Postgres (Supabase) store. Same interface as makeStore() in store.js:
// list(), create(), get(id), remove(id), apply(id, ops).
//
// On the first request after a cold start it makes sure the tables exist and,
// once ever, copies any data from the old Vercel Blob store into Postgres.

import postgres from 'postgres';
import { HttpError, SIDES, newId, cleanName, cleanDice, cleanValue, cleanTime } from './store.js';

/* ---------- connection ---------- */

function connectionString() {
  const env = process.env;
  const key =
    ['POSTGRES_URL', 'DATABASE_URL'].find((k) => env[k]) ||
    Object.keys(env).find((k) => k.endsWith('_POSTGRES_URL')) ||
    (env.POSTGRES_URL_NON_POOLING && 'POSTGRES_URL_NON_POOLING');
  if (!key) {
    throw new HttpError(500, 'Database not connected (no POSTGRES_URL). Connect the Supabase database to this project in Vercel, then redeploy.');
  }
  // Keep only sslmode: Supabase adds extra params (e.g. supa=…) the driver would forward to the server.
  const u = new URL(env[key]);
  for (const p of [...u.searchParams.keys()]) if (p !== 'sslmode') u.searchParams.delete(p);
  return u.toString();
}

let _sql;
export function db() {
  if (!_sql) {
    const url = connectionString();
    const local = /@(localhost|127\.0\.0\.1)[:/]/.test(url);
    _sql = postgres(url, {
      prepare: false, // required for Supabase's transaction pooler (port 6543)
      ssl: local ? false : 'require',
      max: 3,
      idle_timeout: 20,
      connect_timeout: 10,
    });
  }
  return _sql;
}

/* ---------- schema + one-time migration ---------- */

const LOCK_KEY = 7317001; // advisory lock id for setup

export async function ensureSchema(sql) {
  await sql`create table if not exists dice_measurements (
    id text primary key,
    name text not null,
    dice int not null,
    sides int not null default 6,
    created_at timestamptz not null default now()
  )`;
  await sql`create table if not exists dice_rolls (
    id text primary key,
    measurement_id text not null references dice_measurements(id) on delete cascade,
    t timestamptz not null,
    v int not null
  )`;
  await sql`create index if not exists dice_rolls_m_t on dice_rolls (measurement_id, t)`;
  await sql`create table if not exists dice_meta (key text primary key, value text not null)`;
  // Tables live in the public schema; RLS with no policies keeps them out of the
  // public Supabase REST API. The server connects as the owner, which bypasses RLS.
  await sql`alter table dice_measurements enable row level security`;
  await sql`alter table dice_rolls enable row level security`;
  await sql`alter table dice_meta enable row level security`;
}

async function getMeta(sql, key) {
  const r = await sql`select value from dice_meta where key = ${key}::text`;
  return r[0]?.value ?? null;
}

// Insert full measurement documents (as stored in Blob). Existing ids are left untouched.
export async function importMeasurements(sql, docs) {
  if (!docs.length) return { measurements: 0, rolls: 0 };
  const ms = docs.map((m) => ({ id: m.id, name: m.name, dice: m.dice, sides: m.sides || SIDES, created_at: m.createdAt }));
  const rs = docs.flatMap((m) => (m.rolls || []).map((r) => ({ id: r.id, measurement_id: m.id, t: r.t, v: r.v })));
  const mi = await sql`insert into dice_measurements (id, name, dice, sides, created_at)
    select id, name, dice, sides, created_at
    from json_to_recordset(${JSON.stringify(ms)}::text::json) as x(id text, name text, dice int, sides int, created_at timestamptz)
    on conflict (id) do nothing returning id`;
  let rolls = 0;
  for (let i = 0; i < rs.length; i += 5000) {
    const ri = await sql`insert into dice_rolls (id, measurement_id, t, v)
      select id, measurement_id, t, v
      from json_to_recordset(${JSON.stringify(rs.slice(i, i + 5000))}::text::json) as x(id text, measurement_id text, t timestamptz, v int)
      on conflict (id) do nothing returning id`;
    rolls += ri.length;
  }
  return { measurements: mi.length, rolls };
}

async function migrateFromBlob(sql) {
  if (await getMeta(sql, 'blob_migrated')) return;
  let docs;
  try {
    const { blobAdapter } = await import('./blob-adapter.js');
    docs = await blobAdapter.readAll(); // network call, done outside the transaction
  } catch (e) {
    console.error('Blob migration skipped (will retry on next cold start):', e?.message || e);
    return;
  }
  await sql.begin(async (tx) => {
    await tx`select pg_advisory_xact_lock(${LOCK_KEY + 1}::bigint)`;
    if (await getMeta(tx, 'blob_migrated')) return;
    const res = await importMeasurements(tx, docs);
    const note = JSON.stringify({ at: new Date().toISOString(), found: docs.length, ...res });
    await tx`insert into dice_meta (key, value) values ('blob_migrated', ${note}::text) on conflict (key) do nothing`;
    console.log('Blob migration done', note);
  });
}

let ready;
export function init(sql = db()) {
  ready ||= (async () => {
    await sql.begin(async (tx) => {
      await tx`select pg_advisory_xact_lock(${LOCK_KEY}::bigint)`;
      await ensureSchema(tx);
    });
    // A failed migration must never take the app down; it is retried on the next cold start.
    await migrateFromBlob(sql).catch((e) => console.error('Blob migration failed (will retry):', e?.message || e));
  })().catch((e) => {
    ready = null; // retry on next request
    throw e;
  });
  return ready;
}

/* ---------- store ---------- */

const iso = (t) => (t == null ? null : new Date(t).toISOString());
const checkId = (id) => {
  if (!id || !/^[a-z0-9]+$/i.test(id)) throw new HttpError(400, 'Bad id');
};

async function loadFull(sql, id) {
  const [m] = await sql`select id, name, dice, sides, created_at from dice_measurements where id = ${id}::text`;
  if (!m) throw new HttpError(404, 'Measurement not found');
  const rolls = await sql`select id, t, v from dice_rolls where measurement_id = ${id}::text order by t, id`;
  return {
    id: m.id,
    name: m.name,
    dice: Number(m.dice),
    sides: Number(m.sides),
    createdAt: iso(m.created_at),
    rolls: rolls.map((r) => ({ id: r.id, t: iso(r.t), v: Number(r.v) })),
  };
}

export function makePgStore(sql = db()) {
  const q = async (fn) => {
    await init(sql);
    return fn();
  };

  return {
    list: () =>
      q(async () => {
        const rows = await sql`
          select m.id, m.name, m.dice, m.created_at, count(r.id) as n, max(r.t) as last_t
          from dice_measurements m left join dice_rolls r on r.measurement_id = m.id
          group by m.id
          order by coalesce(max(r.t), m.created_at) desc`;
        return rows.map((r) => ({
          id: r.id,
          name: r.name,
          dice: Number(r.dice),
          createdAt: iso(r.created_at),
          count: Number(r.n),
          lastRollAt: iso(r.last_t),
        }));
      }),

    create: ({ name, dice } = {}) =>
      q(async () => {
        const m = { id: newId(), name: cleanName(name), dice: cleanDice(dice) };
        await sql`insert into dice_measurements (id, name, dice, sides) values (${m.id}::text, ${m.name}::text, ${m.dice}::int, ${SIDES}::int)`;
        return loadFull(sql, m.id);
      }),

    get: (id) =>
      q(async () => {
        checkId(id);
        return loadFull(sql, id);
      }),

    remove: (id) =>
      q(async () => {
        checkId(id);
        const r = await sql`delete from dice_measurements where id = ${id}::text returning id`;
        if (!r.length) throw new HttpError(404, 'Measurement not found');
      }),

    // ops: [{op:'add', value, t, rid?}, {op:'update', rid, value}, {op:'delete', rid}, {op:'rename', name}]
    apply: (id, ops) =>
      q(async () => {
        checkId(id);
        await sql.begin(async (tx) => {
          const [m] = await tx`select id, dice from dice_measurements where id = ${id}::text for update`;
          if (!m) throw new HttpError(404, 'Measurement not found');
          m.dice = Number(m.dice);
          for (const o of Array.isArray(ops) ? ops : [ops]) {
            if (o?.op === 'add') {
              const rid = o.rid && /^[a-z0-9]+$/i.test(o.rid) ? o.rid : newId();
              // idempotent: a retried add with the same rid is ignored
              await tx`insert into dice_rolls (id, measurement_id, t, v)
                values (${rid}::text, ${id}::text, ${cleanTime(o.t)}::timestamptz, ${cleanValue(m, o.value)}::int)
                on conflict (id) do nothing`;
            } else if (o?.op === 'update') {
              const r = await tx`update dice_rolls set v = ${cleanValue(m, o.value)}::int
                where id = ${String(o.rid)}::text and measurement_id = ${id}::text returning id`;
              if (!r.length) throw new HttpError(404, 'Roll not found');
            } else if (o?.op === 'delete') {
              await tx`delete from dice_rolls where id = ${String(o.rid)}::text and measurement_id = ${id}::text`;
            } else if (o?.op === 'rename') {
              await tx`update dice_measurements set name = ${cleanName(o.name)}::text where id = ${id}::text`;
            } else {
              throw new HttpError(400, 'Unknown op');
            }
          }
        });
        return loadFull(sql, id);
      }),
  };
}
