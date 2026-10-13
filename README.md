# Cold Email Capacity

Two tools, nothing else. Next.js + Tailwind, no database.

1. **Leads to source** – ids not in any campaign × 150 leads (±5% is fine).
2. **Sending capacity & ramp-up** – domains, ids, emails/day now and at full capacity, and when the remaining ids can be added
   (25 emails / id / day, 4 ids / domain; a new domain starts with 2 ids and gets the other 2 one month after it was bought).

Sender accounts, which campaigns they are in, and warmup reputation come from Smartlead (**Sync Smartlead**).
New domains and ids can be added by hand as soon as they are created; they merge with Smartlead by email address.
Manual entries are saved in the browser (localStorage).

- `config/rules.ts` – the fixed rules (leads per id, emails per id, ids per domain, ramp-up period, which campaign statuses count as "in use")
- `lib/calc.ts` – all calculations
- `app/api/sync/route.ts` – Smartlead sync (server-side only)
- `app/page.tsx` – the page

## Run / deploy
Set `SMARTLEAD_API_KEY` (locally in `.env.local`, on Vercel as an env var), then `npm install && npm run dev`.
Deploy by importing the repo into Vercel.
