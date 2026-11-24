// Core data logic, independent of the storage backend.
// An adapter provides: readAll() -> [measurement], read(id) -> measurement|null,
// write(measurement), remove(id).

export const SIDES = 6;
export const MAX_DICE = 10;

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function newId() {
  return (
    Date.now().toString(36) +
    Math.random().toString(36).slice(2, 8)
  );
}

function cleanName(name) {
  const n = String(name ?? '').trim().slice(0, 80);
  if (!n) throw new HttpError(400, 'Name is required');
  return n;
}

function cleanDice(dice) {
  const d = Number(dice);
  if (!Number.isInteger(d) || d < 1 || d > MAX_DICE) {
    throw new HttpError(400, `Number of dice must be 1–${MAX_DICE}`);
  }
  return d;
}

function cleanValue(m, value) {
  const v = Number(value);
  if (!Number.isInteger(v) || v < m.dice || v > m.dice * SIDES) {
    throw new HttpError(400, `Outcome must be between ${m.dice} and ${m.dice * SIDES}`);
  }
  return v;
}

function cleanTime(t) {
  if (t) {
    const d = new Date(t);
    // accept client timestamps that are sane (not in the far future)
    if (!isNaN(d) && d.getTime() < Date.now() + 5 * 60 * 1000) return d.toISOString();
  }
  return new Date().toISOString();
}

export function summary(m) {
  const last = m.rolls.length ? m.rolls[m.rolls.length - 1].t : null;
  return {
    id: m.id,
    name: m.name,
    dice: m.dice,
    createdAt: m.createdAt,
    count: m.rolls.length,
    lastRollAt: last,
  };
}

export function makeStore(adapter) {
  async function load(id) {
    if (!id || !/^[a-z0-9]+$/i.test(id)) throw new HttpError(400, 'Bad id');
    const m = await adapter.read(id);
    if (!m) throw new HttpError(404, 'Measurement not found');
    return m;
  }

  return {
    async list() {
      const all = await adapter.readAll();
      return all
        .map(summary)
        .sort((a, b) => (b.lastRollAt || b.createdAt).localeCompare(a.lastRollAt || a.createdAt));
    },

    async create({ name, dice }) {
      const m = {
        id: newId(),
        name: cleanName(name),
        dice: cleanDice(dice),
        sides: SIDES,
        createdAt: new Date().toISOString(),
        rolls: [],
      };
      await adapter.write(m);
      return m;
    },

    get: load,

    async remove(id) {
      await load(id);
      await adapter.remove(id);
    },

    // ops: [{op:'add', value, t, rid?}, {op:'update', rid, value}, {op:'delete', rid}, {op:'rename', name}]
    async apply(id, ops) {
      const m = await load(id);
      for (const o of Array.isArray(ops) ? ops : [ops]) {
        if (o.op === 'add') {
          const rid = o.rid && /^[a-z0-9]+$/i.test(o.rid) ? o.rid : newId();
          if (m.rolls.some((r) => r.id === rid)) continue; // idempotent retry
          m.rolls.push({ id: rid, t: cleanTime(o.t), v: cleanValue(m, o.value) });
        } else if (o.op === 'update') {
          const r = m.rolls.find((r) => r.id === o.rid);
          if (!r) throw new HttpError(404, 'Roll not found');
          r.v = cleanValue(m, o.value);
        } else if (o.op === 'delete') {
          m.rolls = m.rolls.filter((r) => r.id !== o.rid);
        } else if (o.op === 'rename') {
          m.name = cleanName(o.name);
        } else {
          throw new HttpError(400, 'Unknown op');
        }
      }
      m.rolls.sort((a, b) => a.t.localeCompare(b.t));
      await adapter.write(m);
      return m;
    },
  };
}
