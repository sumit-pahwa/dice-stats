# Dice Stats

Track long-term dice roll statistics. Create named **measurements** (e.g. "Catan night", "Red dice"), choose how many six-sided dice, then tap the outcome every time you roll.

- **Roll** – one button per possible total (n … 6n). Each tap stores the date, time and outcome. Undo is available right after each tap.
- **Details** – every roll with date, time and outcome. Tap a row to change the outcome or delete it.
- **Distribution** – histogram of outcomes with the expected fair-dice probability marked in gold. Filter by All time / Today / 7 days / 30 days or a custom date-time range.
- Extras: rename/delete a measurement, CSV export, offline-tolerant save queue (taps are retried if the connection drops).

## Stack

- `public/index.html` – the whole frontend (vanilla JS, no build step).
- `api/measurements.js`, `api/measurement.js` – Vercel serverless functions.
- `lib/` – data logic and the Vercel Blob storage adapter.
- Storage: **Vercel Blob**. Each measurement is a JSON document. Every save writes a new uniquely named blob and deletes the previous version, so reads are never served stale from the Blob CDN cache.

## Deploy to Vercel

1. In Vercel, **Add New → Project** and import this GitHub repo. Framework preset: **Other** (no build command needed).
2. In the project, go to **Storage → Create → Blob** and connect the store to the project. This sets `BLOB_READ_WRITE_TOKEN` automatically.
3. Redeploy (Deployments → ⋯ → Redeploy) so the functions pick up the token.

If you create the Blob store as **private**, also add the environment variable `BLOB_ACCESS=private`. With a public store, blob URLs are unguessable but technically public.

## Local development

```bash
node dev/server.js   # http://localhost:3000 — uses a local ./.data folder instead of Blob
```
