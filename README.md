# Cold Email Dashboard

Personal Smartlead dashboard. Next.js + Tailwind, no database.

- `config/defaults.ts` – every tunable number (also editable in the UI, saved to localStorage)
- `app/api/sync/route.ts` – pulls Smartlead data (server-side only)
- `lib/calc.ts` – formulas
- `app/page.tsx` – the dashboard

## Run / deploy
Set `SMARTLEAD_API_KEY` (locally in `.env.local`, on Vercel as an env var), then `npm install && npm run dev`.
Deploy by importing the repo into Vercel. The sync route sets `maxDuration = 300` (needs Fluid Compute, default on new Vercel projects).
# Cold-emailing-
