import { NextResponse } from "next/server";
import { timezone } from "@/config/defaults";
import type { Campaign, DailyStat, Mailbox, SyncData } from "@/lib/calc";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const BASE = "https://server.smartlead.ai/api/v1";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Smartlead allows 10 req / 2s; one call every 200ms stays at 5/s.
async function sl(path: string, params: Record<string, string | number> = {}, retries = 3): Promise<any> {
  await sleep(200);
  const url = new URL(BASE + path);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
  url.searchParams.set("api_key", process.env.SMARTLEAD_API_KEY!);
  const res = await fetch(url, { cache: "no-store" });
  if (res.status === 429 && retries > 0) {
    await sleep(2000);
    return sl(path, params, retries - 1);
  }
  if (!res.ok) throw new Error(`Smartlead returned ${res.status} for ${path}`);
  return res.json();
}

export async function POST() {
  if (!process.env.SMARTLEAD_API_KEY) {
    return NextResponse.json({ error: "SMARTLEAD_API_KEY is not set" }, { status: 500 });
  }
  try {
    // Category id -> name, straight from the account
    const cats: Record<string, string> = {};
    for (const c of await sl("/leads/fetch-categories")) cats[c.id] = c.name;

    // Mailboxes
    const mailboxes: Mailbox[] = [];
    for (let offset = 0; ; offset += 100) {
      const page = await sl("/email-accounts/", { offset, limit: 100 });
      for (const a of page) {
        const email: string = a.from_email ?? a.email ?? "";
        mailboxes.push({ email, domain: email.split("@")[1]?.toLowerCase() ?? "", dailyLimit: a.message_per_day ?? 0 });
      }
      if (page.length < 100) break;
    }

    // Campaigns
    const campaigns: Campaign[] = [];
    for (const c of await sl("/campaigns/")) {
      // Sequence step delays
      const seqs = await sl(`/campaigns/${c.id}/sequences`);
      const stepDelays = [...seqs]
        .sort((a: any, b: any) => a.seq_number - b.seq_number)
        .map((s: any) => s.seq_delay_details?.delayInDays ?? s.seq_delay_details?.delay_in_days ?? 0);

      // Mailboxes attached to this campaign
      const inboxCount = (await sl(`/campaigns/${c.id}/email-accounts`)).length;

      // All leads, paginated
      const leadStatus: Record<string, number> = {};
      const categories: Record<string, number> = {};
      let totalLeads = 0;
      for (let offset = 0; ; offset += 100) {
        const page = await sl(`/campaigns/${c.id}/leads`, { offset, limit: 100 });
        const rows = page.data ?? [];
        for (const l of rows) {
          totalLeads++;
          leadStatus[l.status] = (leadStatus[l.status] ?? 0) + 1;
          const catId = l.lead_category_id ?? l.lead?.lead_category_id;
          const name = catId != null ? cats[catId] ?? `Category ${catId}` : "No category";
          categories[name] = (categories[name] ?? 0) + 1;
        }
        if (rows.length < 100 || totalLeads >= Number(page.total_leads ?? 0)) break;
      }

      // Statistics: send/open/reply/bounce counts + earliest send time
      const stats = { sent: 0, opened: 0, replied: 0, bounced: 0 };
      let earliest = Infinity;
      for (let offset = 0, page = 0; page < 30; offset += 1000, page++) {
        const res = await sl(`/campaigns/${c.id}/statistics`, { offset, limit: 1000 });
        const rows = res.data ?? [];
        for (const r of rows) {
          if (r.sent_time) {
            stats.sent++;
            earliest = Math.min(earliest, new Date(r.sent_time).getTime());
          }
          if (r.open_time) stats.opened++;
          if (r.reply_time) stats.replied++;
          if (r.is_bounced) stats.bounced++;
        }
        if (rows.length < 1000) break;
      }

      campaigns.push({
        id: c.id,
        name: c.name,
        status: c.status,
        createdAt: c.created_at,
        stepDelays,
        startDate: Number.isFinite(earliest) ? new Date(earliest).toISOString() : null,
        totalLeads,
        leadStatus,
        categories,
        inboxCount,
        stats,
      });
    }

    // Daily report: emails sent per day for the last 14 days (today = sent so far)
    let daily: DailyStat[] = [];
    let dailyError: string | undefined;
    try {
      const ymd = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: timezone });
      const res = await sl("/analytics/day-wise-overall-stats", {
        start_date: ymd(new Date(Date.now() - 13 * 86400000)),
        end_date: ymd(new Date()),
        timezone,
      });
      const list = res?.data?.day_wise_stats ?? res?.data ?? res?.day_wise_stats ?? [];
      daily = (Array.isArray(list) ? list : []).map((d: any) => ({
        date: String(d.date ?? d.day ?? "").slice(0, 10),
        sent: Number(d.email_engagement_metrics?.sent ?? d.sent_count ?? d.sent ?? 0),
      }));
      if (daily.length === 0) dailyError = "Smartlead returned no daily data";
    } catch (e) {
      dailyError = e instanceof Error ? e.message : "Daily report failed";
    }

    const data: SyncData = { syncedAt: new Date().toISOString(), campaigns, mailboxes, daily, dailyError };
    return NextResponse.json(data);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Sync failed" }, { status: 502 });
  }
}
