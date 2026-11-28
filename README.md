# Dice Stats

Track long-term dice roll statistics. Create named **measurements** (e.g. "Catan night", "Red dice"), choose how many six-sided dice, then tap the outcome every time you roll.

- **Roll** – one button per possible total (n … 6n). Each tap stores the date, time and outcome. Undo is available right after each tap.
- **Details** – every roll with date, time and outcome. Tap a row to change the outcome or delete it.
- **Distribution** – histogram of outcomes with the expected fair-dice probability marked in gold. Filter by All time / Today / 7 days / 30 days or a custom date-time range.
- Extras: rename/delete a measurement, CSV export, offline-tolerant save queue (taps are retried if the connection drops).

## Stack

- `public/index.html` – the whole frontend (vanilla JS, no build step).
- `api/measurements.js`, `api/measurement.js` – Vercel serverless functions.
- `lib/pg-store.js` – data layer on **Supabase Postgres** (via the `postgres` driver and the `POSTGRES_URL` env var that the Supabase integration adds).
- Tables (`dice_measurements`, `dice_rolls`, `dice_meta`) are created automatically on first request, with row-level security enabled so they are not exposed through Supabase's public REST API.

## Migration from Vercel Blob

Earlier versions stored data in Vercel Blob. On the first request after deploying, the app copies every measurement and roll from the Blob store into Postgres once (existing rows are never overwritten) and records the result in `dice_meta`. Check `/api/health` to see the counts and migration result. The Blob data is left in place as a backup; once you're happy, you can delete the Blob store and remove `@vercel/blob` and `lib/blob-adapter.js`.

## Deploy to Vercel

1. Import this repo in Vercel (framework preset: **Other**, no build command).
2. Storage → connect a **Supabase** database to the project. This adds `POSTGRES_URL` and friends.
3. Redeploy. Visit `/api/health` to confirm `"database": "ok"`.

## Local development

```bash
node dev/server.js                      # uses a local ./.data folder
POSTGRES_URL=postgres://... node dev/server.js   # uses Postgres
```
