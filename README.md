# Cold Email Capacity

Two tools, nothing else. Next.js + Tailwind, no database.

1. **Leads to source** – ids not in any campaign × 150 leads (±5% is fine).
2. **Sending capacity & ramp-up** – domains, ids, emails/day now and at full capacity, and when the remaining ids can be added
   (4 ids / domain; a new domain starts with 2 ids and gets the other 2 one month after it was bought).
   Emails per id come from each id's daily limit in Smartlead: change it there, click Sync, and every number follows.

Everything comes from Smartlead (**Sync Smartlead**): sender accounts grouped by domain, which campaigns they are in, and warmup reputation.
The only thing you can change on the page is a domain's purchase date (Smartlead only knows when an id was added); it is saved in the browser.

- `config/rules.ts` – the fixed rules (leads per id, emails per id, ids per domain, ramp-up period, which campaign statuses count as "in use": only active ones)
- `lib/calc.ts` – all calculations
- `app/api/sync/route.ts` – Smartlead sync (server-side only)
- `app/page.tsx` – the page

## Run / deploy
Set `SMARTLEAD_API_KEY` (locally in `.env.local`, on Vercel as an env var), then `npm install && npm run dev`.
Deploy by importing the repo into Vercel.
