// HTTP handlers shared by the Vercel functions and the local dev server.
import { HttpError } from './store.js';

function send(res, status, body) {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json');
  res.setHeader('cache-control', 'no-store');
  res.end(JSON.stringify(body));
}

function wrap(fn) {
  return async (req, res) => {
    try {
      await fn(req, res);
    } catch (e) {
      if (e instanceof HttpError) return send(res, e.status, { error: e.message });
      console.error(e);
      send(res, 500, { error: `Server error: ${e?.message || e}` });
    }
  };
}

function body(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') return JSON.parse(req.body || '{}');
  return {};
}

// /api/measurements
export const measurementsHandler = (store) =>
  wrap(async (req, res) => {
    if (req.method === 'GET') return send(res, 200, await store.list());
    if (req.method === 'POST') return send(res, 201, await store.create(body(req)));
    send(res, 405, { error: 'Method not allowed' });
  });

// /api/measurement?id=...
export const measurementHandler = (store) =>
  wrap(async (req, res) => {
    const id = req.query?.id;
    if (req.method === 'GET') return send(res, 200, await store.get(id));
    if (req.method === 'POST') return send(res, 200, await store.apply(id, body(req).ops));
    if (req.method === 'DELETE') {
      await store.remove(id);
      return send(res, 200, { ok: true });
    }
    send(res, 405, { error: 'Method not allowed' });
  });
