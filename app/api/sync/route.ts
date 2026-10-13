import { NextResponse } from "next/server";
import { rules, timezone } from "@/config/rules";
import { dayKey } from "@/lib/calc";
import type { SyncData, SyncedAccount } from "@/lib/calc";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const BASE = "https://server.smartlead.ai/api/v1";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Smartlead allows 10 requests / 2s. Calls are spaced 220ms apart (~4.5/s) even when run in parallel.
let nextSlot = 0;
async function throttle() {
  const now = Date.now();
  const wait = Math.max(0, nextSlot - now);
  nextSlot = Math.max(now, nextSlot) + 220;
  if (wait) await sleep(wait);
}

async function sl(path: string, params: Record<string, string | number> = {}, retries = 3): Promise<any> {
  await throttle();
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

// "98%", "98", 98 -> 98
function percent(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = parseFloat(String(v));
  return Number.isFinite(n) ? n : null;
}

// Runs fn over items, at most `limit` at a time
async function pool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx]);
    }
  });
  await Promise.all(workers);
  return out;
}

async function sync(): Promise<SyncData> {
  // 1. Every sender account, with warmup details
  const raw: any[] = [];
  for (let offset = 0; ; offset += 100) {
    const page = await sl("/email-accounts/", { offset, limit: 100 });
    const rows = Array.isArray(page) ? page : page?.data ?? [];
    raw.push(...rows);
    if (rows.length < 100) break;
  }

  // 2. Which accounts sit in an in-use campaign
  const campaigns: any[] = await sl("/campaigns/");
  const inUse = (Array.isArray(campaigns) ? campaigns : []).filter((c) => rules.inUseCampaignStatuses.includes(c.status));
  const usedBy = new Map<string, string[]>(); // key: account id or email
  await pool(inUse, 3, async (c) => {
    const accounts = await sl(`/campaigns/${c.id}/email-accounts`);
    for (const a of Array.isArray(accounts) ? accounts : []) {
      const keys = [`id:${a.id}`, `email:${String(a.from_email ?? a.email ?? "").toLowerCase()}`];
      for (const k of keys) usedBy.set(k, [...new Set([...(usedBy.get(k) ?? []), c.name])]);
    }
  });

  const accounts: SyncedAccount[] = raw
    .map((a) => {
      const email = String(a.from_email ?? a.email ?? a.username ?? "").trim().toLowerCase();
      const created = a.created_at ? new Date(a.created_at) : null;
      const used = [...new Set([...(usedBy.get(`id:${a.id}`) ?? []), ...(usedBy.get(`email:${email}`) ?? [])])];
      return {
        id: Number(a.id),
        email,
        domain: email.split("@")[1] ?? "",
        createdOn: created && !isNaN(created.getTime()) ? dayKey(created, timezone) : null,
        dailyLimit: Number(a.message_per_day ?? 0),
        warmupStatus: a.warmup_details?.status ?? null,
        reputation: percent(a.warmup_details?.warmup_reputation),
        campaigns: used,
      };
    })
    .filter((a) => a.email.includes("@"));

  return { syncedAt: new Date().toISOString(), accounts, campaignsChecked: inUse.length };
}

export async function POST() {
  if (!process.env.SMARTLEAD_API_KEY) {
    return NextResponse.json({ error: "SMARTLEAD_API_KEY is not set" }, { status: 500 });
  }
  try {
    return NextResponse.json(await sync());
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Sync failed" }, { status: 502 });
  }
}
