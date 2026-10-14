import { rules } from "@/config/rules";

// ---------- Data shapes ----------

// One sender account as pulled from Smartlead
export type SyncedAccount = {
  id: number;
  email: string;
  domain: string;
  createdOn: string | null; // YYYY-MM-DD, when it was added to Smartlead
  dailyLimit: number;
  warmupStatus: string | null;
  reputation: number | null; // warmup reputation in %
  campaigns: string[]; // in-use campaigns this id is attached to
};
export type SyncData = { syncedAt: string; accounts: SyncedAccount[]; campaignsChecked: number };

// Purchase dates corrected in the UI: domain -> YYYY-MM-DD
export type PurchaseDates = Record<string, string>;

export type Id = {
  email: string;
  domain: string;
  createdOn: string | null;
  dailyLimit: number; // emails / day as set in Smartlead
  reputation: number | null;
  warmupStatus: string | null;
  campaigns: string[];
  unused: boolean; // not attached to any in-use campaign
};

export type Domain = {
  domain: string;
  since: string | null; // purchase date set in the UI or, failing that, the earliest id date
  sinceIsEstimate: boolean;
  ids: Id[];
  count: number;
  capacity: number; // emails / day right now: sum of the ids' Smartlead daily limits
  offRate: Id[]; // ids whose daily limit differs from the usual one
  unlockOn: string | null; // date the remaining ids can be added
  addNow: number; // ids that can be added today
  addLater: number; // ids that can be added on unlockOn
  allowedNow: number; // max ids the rules allow on this domain today
  overLimit: boolean; // more ids than allowedNow
  reputation: number | null; // average over the domain's ids
};

// ---------- Dates (all as YYYY-MM-DD strings) ----------

export const DAY = 86400000;

export function dayKey(d: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(d);
  const get = (t: string) => parts.find((x) => x.type === t)!.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

const toUtc = (ymd: string) => {
  const [y, m, d] = ymd.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
};

// Adds calendar months; 31 Jan + 1 month = 28/29 Feb
export function addMonths(ymd: string, months: number) {
  const [y, m, d] = ymd.split("-").map(Number);
  const first = new Date(Date.UTC(y, m - 1 + months, 1));
  const lastDay = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  first.setUTCDate(Math.min(d, lastDay));
  return first.toISOString().slice(0, 10);
}

export const daysBetween = (from: string, to: string) => Math.round((toUtc(to) - toUtc(from)) / DAY);

export const isYmd = (s: unknown): s is string => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);

// ---------- Emails per id: read from Smartlead ----------

// The daily limit most ids have in Smartlead (ties go to the higher limit); rules.emailsPerId before the first sync
export function sendingRate(sync: SyncData | null) {
  const counts = new Map<number, number>();
  for (const a of sync?.accounts ?? []) if (a.dailyLimit > 0) counts.set(a.dailyLimit, (counts.get(a.dailyLimit) ?? 0) + 1);
  let rate = rules.emailsPerId, best = 0;
  for (const [limit, n] of counts) if (n > best || (n === best && limit > rate)) [rate, best] = [limit, n];
  return rate;
}

// ---------- Inventory: Smartlead sender accounts grouped by domain ----------

export function buildInventory(sync: SyncData | null, dates: PurchaseDates, today: string, rate: number): Domain[] {
  const byDomain = new Map<string, Id[]>();
  for (const a of sync?.accounts ?? []) {
    if (!a.domain) continue;
    const id: Id = {
      email: a.email,
      domain: a.domain,
      createdOn: a.createdOn,
      dailyLimit: a.dailyLimit,
      reputation: a.reputation,
      warmupStatus: a.warmupStatus,
      campaigns: a.campaigns,
      unused: a.campaigns.length === 0,
    };
    byDomain.set(a.domain, [...(byDomain.get(a.domain) ?? []), id]);
  }

  const domains: Domain[] = [];
  for (const [name, ids] of byDomain) {
    const list = ids.sort((a, b) => a.email.localeCompare(b.email));
    const set = isYmd(dates[name]) ? dates[name] : null;
    const since = set ?? list.map((i) => i.createdOn).filter(isYmd).sort()[0] ?? null;
    const count = list.length;

    const unlockOn = since ? addMonths(since, rules.monthsBeforeFullDomain) : null;
    const unlocked = !unlockOn || unlockOn <= today;
    const allowedNow = unlocked ? rules.idsPerDomain : rules.initialIdsPerDomain;
    const addNow = Math.max(0, allowedNow - count);
    const addLater = unlocked ? 0 : Math.max(0, rules.idsPerDomain - Math.max(count, rules.initialIdsPerDomain));

    const reps = list.map((i) => i.reputation).filter((r): r is number => r != null);
    domains.push({
      domain: name,
      since,
      sinceIsEstimate: !set && since != null,
      ids: list,
      count,
      capacity: list.reduce((s, i) => s + i.dailyLimit, 0),
      offRate: list.filter((i) => i.dailyLimit !== rate),
      unlockOn: unlocked ? null : unlockOn,
      addNow,
      addLater,
      allowedNow,
      overLimit: count > allowedNow,
      reputation: reps.length ? reps.reduce((a, b) => a + b, 0) / reps.length : null,
    });
  }
  return domains.sort((a, b) => (b.since ?? "").localeCompare(a.since ?? "") || a.domain.localeCompare(b.domain));
}

// ---------- Part 1: lead sourcing ----------

export function leadsNeeded(unusedIds: number) {
  const leads = Math.max(0, unusedIds) * rules.leadsPerId;
  const t = rules.leadsTolerancePercent / 100;
  return { leads, low: Math.round(leads * (1 - t)), high: Math.round(leads * (1 + t)) };
}

// ---------- Part 2: capacity and ramp-up ----------

export type RampStep = { on: string; domains: string[]; ids: number; emails: number; capacityAfter: number };

// rate = emails / day for every id still to be added
export function rampUp(domains: Domain[], rate: number) {
  const ids = domains.reduce((s, d) => s + d.count, 0);
  const capacityNow = domains.reduce((s, d) => s + d.capacity, 0);
  const openSlots = domains.reduce((s, d) => s + Math.max(0, rules.idsPerDomain - d.count), 0);
  const addNowDomains = domains.filter((d) => d.addNow > 0);
  const addNow = addNowDomains.reduce((s, d) => s + d.addNow, 0);

  const byDate = new Map<string, Domain[]>();
  for (const d of domains) {
    if (d.addLater > 0 && d.unlockOn) byDate.set(d.unlockOn, [...(byDate.get(d.unlockOn) ?? []), d]);
  }
  let running = capacityNow + addNow * rate;
  const steps: RampStep[] = [...byDate.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([on, list]) => {
      const n = list.reduce((s, d) => s + d.addLater, 0);
      running += n * rate;
      return { on, domains: list.map((d) => d.domain), ids: n, emails: n * rate, capacityAfter: running };
    });

  return {
    domains: domains.length,
    ids,
    maxIds: domains.length * rules.idsPerDomain,
    openSlots,
    capacityNow,
    maxCapacity: capacityNow + openSlots * rate,
    addNow,
    addNowDomains,
    steps,
    overLimit: domains.filter((d) => d.overLimit),
    offRate: domains.flatMap((d) => d.offRate),
  };
}

// How many new domains to buy to reach a daily sending target, on top of full current capacity
export function domainsForTarget(target: number, maxCapacity: number, rate: number) {
  const perDomain = rate * rules.idsPerDomain;
  const gap = Math.max(0, target - maxCapacity);
  const buy = Math.ceil(gap / perDomain);
  return {
    gap,
    buy,
    dayOne: buy * rules.initialIdsPerDomain * rate,
    full: buy * perDomain,
  };
}
