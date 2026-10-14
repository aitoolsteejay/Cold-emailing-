"use client";

import { useEffect, useState } from "react";
import { maxEmailsPerDomain, rules, timezone } from "@/config/rules";
import { buildInventory, dayKey, daysBetween, domainsForTarget, isYmd, leadsNeeded, rampUp } from "@/lib/calc";
import type { Domain, Id, PurchaseDates, SyncData } from "@/lib/calc";

const K_SYNC = "ce-sync", K_DATES = "ce-dates", K_TARGET = "ce-target";
const K_MANUAL = "ce-manual"; // hand-added domains/ids from the earlier version; only their purchase dates are kept
const OLD_KEYS = ["sl-data", "sl-settings", "sl-planned", K_MANUAL]; // removed on load

const num = (n: number) => Math.round(n).toLocaleString("en-IN");
const fmt = (ymd: string) => new Date(ymd + "T00:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const plural = (n: number, word: string) => `${num(n)} ${word}${n === 1 ? "" : "s"}`;

function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}
function save(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {}
}

// Drops anything malformed so a bad localStorage value can't break the page
function cleanDates(d: any): PurchaseDates {
  const out: PurchaseDates = {};
  if (d && typeof d === "object" && !Array.isArray(d)) for (const [k, v] of Object.entries(d)) if (isYmd(v)) out[k] = v;
  return out;
}
// Purchase dates typed into the earlier version's "Bought a new domain" form
function datesFromOldManual(m: any): PurchaseDates {
  const out: PurchaseDates = {};
  for (const d of Array.isArray(m?.domains) ? m.domains : []) if (typeof d?.domain === "string" && isYmd(d?.purchasedOn)) out[d.domain] = d.purchasedOn;
  return out;
}
function cleanSync(s: any): SyncData | null {
  return s && typeof s.syncedAt === "string" && Array.isArray(s.accounts) ? s : null;
}

const tagStyle = {
  green: "bg-emerald-50 text-emerald-700 ring-emerald-600/20",
  amber: "bg-amber-50 text-amber-700 ring-amber-600/20",
  red: "bg-rose-50 text-rose-700 ring-rose-600/20",
  violet: "bg-violet-50 text-violet-700 ring-violet-600/20",
  slate: "bg-slate-100 text-slate-600 ring-slate-500/20",
};
function Tag({ kind, children }: { kind: keyof typeof tagStyle; children: React.ReactNode }) {
  return <span className={`inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${tagStyle[kind]}`}>{children}</span>;
}

function Card({ title, right, children }: { title: string; right?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-slate-700">{title}</h3>
        {right}
      </div>
      {children}
    </section>
  );
}

function Kpi({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-1 text-2xl font-bold tracking-tight">{value}</div>
      {sub && <div className="mt-0.5 text-xs text-slate-500">{sub}</div>}
    </div>
  );
}

function Rep({ value }: { value: number | null }) {
  if (value == null) return <span className="text-slate-400">—</span>;
  return <span className={value < rules.lowReputationBelow ? "font-medium text-rose-600" : "text-emerald-700"}>{value.toFixed(0)}%</span>;
}

export default function Home() {
  const [today, setToday] = useState("");
  const [sync, setSync] = useState<SyncData | null>(null);
  const [dates, setDates] = useState<PurchaseDates>({});
  const [target, setTarget] = useState(0);
  const [override, setOverride] = useState<number | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState("");
  const [open, setOpen] = useState<string[]>([]);

  useEffect(() => {
    setToday(dayKey(new Date(), timezone));
    setSync(cleanSync(load(K_SYNC, null)));
    const d = { ...datesFromOldManual(load(K_MANUAL, null)), ...cleanDates(load(K_DATES, {})) };
    setDates(d);
    save(K_DATES, d);
    setTarget(Number(load(K_TARGET, 0)) || 0);
    try {
      for (const k of OLD_KEYS) localStorage.removeItem(k);
    } catch {}
  }, []);

  function saveDates(next: PurchaseDates) {
    setDates(next);
    save(K_DATES, next);
  }

  async function runSync() {
    setSyncing(true);
    setError("");
    try {
      const res = await fetch("/api/sync", { method: "POST" });
      const text = await res.text();
      let json: any;
      try {
        json = JSON.parse(text);
      } catch {
        throw new Error(`Server error ${res.status}: the sync took too long or failed`);
      }
      if (!res.ok) throw new Error(json.error ?? "Sync failed");
      setSync(json);
      save(K_SYNC, json);
      setOverride(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Sync failed");
    }
    setSyncing(false);
  }

  if (!today) return <div className="p-8 text-sm text-slate-400">Loading…</div>;

  const domains = buildInventory(sync, dates, today);
  const unused = domains.flatMap((d) => d.ids).filter((i) => i.unused);
  const unusedCount = override ?? unused.length;
  const leads = leadsNeeded(unusedCount);
  const ramp = rampUp(domains);
  const goal = domainsForTarget(target, ramp.maxCapacity);

  // Empty value = go back to the date estimated from Smartlead
  function setPurchase(domain: string, ymd: string) {
    const { [domain]: _, ...rest } = dates;
    saveDates(isYmd(ymd) ? { ...rest, [domain]: ymd } : rest);
  }

  function nextStep(d: Domain) {
    if (d.overLimit)
      return <Tag kind="red">{d.count} ids · max {d.allowedNow}{d.unlockOn ? ` until ${fmt(d.unlockOn)}` : ""}</Tag>;
    if (d.addNow > 0) return <Tag kind="amber">Add {plural(d.addNow, "id")} now</Tag>;
    if (d.addLater > 0 && d.unlockOn)
      return <Tag kind="violet">Add {d.addLater} on {fmt(d.unlockOn)} · {daysBetween(today, d.unlockOn)}d</Tag>;
    return <Tag kind="green">Full</Tag>;
  }

  function idNote(i: Id) {
    if (i.campaigns.length) return <span className="text-xs text-slate-500">{i.campaigns.join(", ")}</span>;
    return <Tag kind="amber">Not in any campaign</Tag>;
  }

  const toggle = (d: string) => setOpen(open.includes(d) ? open.filter((x) => x !== d) : [...open, d]);

  return (
    <div className="mx-auto max-w-6xl space-y-8 p-4 md:p-8">
      {/* Header */}
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Cold email capacity</h1>
          <p className="text-sm text-slate-500">
            {sync
              ? `Smartlead synced ${new Date(sync.syncedAt).toLocaleString("en-GB", { timeZone: timezone })} · ${plural(sync.accounts.length, "sender account")} · ${plural(sync.campaignsChecked, "campaign")} checked`
              : "Smartlead not synced yet — sync to pull sender accounts, campaign usage and warmup reputation."}
          </p>
        </div>
        <button onClick={runSync} disabled={syncing} className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm disabled:opacity-60">
          {syncing ? "Syncing…" : "Sync Smartlead"}
        </button>
      </header>
      {error && <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">{error}</div>}

      {/* ---------- Part 1: lead sourcing ---------- */}
      <section className="space-y-4">
        <h2 className="text-lg font-semibold">1 · Leads to source</h2>
        <Card title={`${rules.leadsPerId} leads for every id that is not in a campaign`}>
          <div className="grid gap-6 md:grid-cols-2">
            <div>
              <label className="text-xs font-medium text-slate-500">
                IDs not in any campaign
                <input
                  type="number"
                  min={0}
                  value={unusedCount}
                  onChange={(e) => setOverride(Math.max(0, Math.floor(Number(e.target.value) || 0)))}
                  className="mt-1 block w-40 rounded-md border border-slate-300 px-3 py-2 text-2xl font-bold text-slate-900 focus:border-indigo-500 focus:outline-none"
                />
              </label>
              <p className="mt-2 text-xs text-slate-500">
                {override != null ? (
                  <>
                    Your own number. The tracked count is {unused.length}.{" "}
                    <button onClick={() => setOverride(null)} className="font-medium text-indigo-600 underline">Use {unused.length}</button>
                  </>
                ) : (
                  <>
                    Smartlead ids with no {rules.inUseCampaignStatuses.join("/").toLowerCase()} campaign. Type any number to try it.
                  </>
                )}
              </p>
              {!sync && <p className="mt-2 text-xs text-amber-700">Click Sync Smartlead to load your ids.</p>}
            </div>
            <div className="rounded-xl bg-indigo-600 p-5 text-white">
              <div className="text-xs font-medium uppercase tracking-wide text-indigo-200">Source</div>
              <div className="text-4xl font-bold tracking-tight">{num(leads.leads)} leads</div>
              <div className="mt-1 text-sm text-indigo-100">
                {unusedCount} × {rules.leadsPerId} · anything from <b>{num(leads.low)}</b> to <b>{num(leads.high)}</b> is fine (±{rules.leadsTolerancePercent}%)
              </div>
            </div>
          </div>

          {unused.length > 0 && (
            <details className="mt-5">
              <summary className="cursor-pointer text-sm font-medium text-indigo-600">Show the {plural(unused.length, "unused id")}</summary>
              <div className="mt-3 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-xs uppercase tracking-wide text-slate-400">
                      <th className="pb-2 font-medium">ID</th>
                      <th className="pb-2 font-medium">Warmup</th>
                      <th className="pb-2 font-medium">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {unused.map((i) => (
                      <tr key={i.email} className="border-b border-slate-100 last:border-0">
                        <td className="py-2 pr-4">{i.email}</td>
                        <td className="py-2 pr-4"><Rep value={i.reputation} /></td>
                        <td className="py-2">{idNote(i)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          )}
        </Card>
      </section>

      {/* ---------- Part 2: capacity and ramp-up ---------- */}
      <section className="space-y-4">
        <h2 className="text-lg font-semibold">2 · Sending capacity &amp; ramp-up</h2>
        <p className="-mt-2 text-xs text-slate-500">
          Rules: {rules.emailsPerId} emails / id / day · {rules.idsPerDomain} ids / domain = {maxEmailsPerDomain} emails / domain / day · a new domain starts with {rules.initialIdsPerDomain} ids, the rest can be added {rules.monthsBeforeFullDomain} month{rules.monthsBeforeFullDomain === 1 ? "" : "s"} after buying it.
        </p>

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Kpi label="Domains" value={num(ramp.domains)} />
          <Kpi label="IDs" value={`${num(ramp.ids)} / ${num(ramp.maxIds)}`} sub={`${plural(ramp.openSlots, "slot")} open`} />
          <Kpi label="Can send now" value={`${num(ramp.capacityNow)} / day`} sub={`${num(ramp.ids)} ids × ${rules.emailsPerId}`} />
          <Kpi label="Max when all domains full" value={`${num(ramp.maxCapacity)} / day`} sub={`+${num(ramp.maxCapacity - ramp.capacityNow)} still to unlock`} />
        </div>

        <Card title="Ramp-up plan">
          {ramp.addNow === 0 && ramp.steps.length === 0 ? (
            <p className="text-sm text-slate-500">
              {ramp.domains ? "Every domain has all its ids. To send more, buy new domains." : "Sync Smartlead to see the plan."}
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs uppercase tracking-wide text-slate-400">
                    <th className="pb-2 font-medium">When</th>
                    <th className="pb-2 font-medium">Add</th>
                    <th className="pb-2 font-medium">Domains</th>
                    <th className="pb-2 text-right font-medium">Capacity after</th>
                  </tr>
                </thead>
                <tbody>
                  {ramp.addNow > 0 && (
                    <tr className="border-b border-slate-100">
                      <td className="py-2 pr-4"><Tag kind="amber">Now</Tag></td>
                      <td className="py-2 pr-4 whitespace-nowrap">{plural(ramp.addNow, "id")} · +{num(ramp.addNow * rules.emailsPerId)}/day</td>
                      <td className="py-2 pr-4 text-xs text-slate-500">{ramp.addNowDomains.map((d) => `${d.domain} (+${d.addNow})`).join(", ")}</td>
                      <td className="py-2 text-right tabular-nums">{num(ramp.capacityNow + ramp.addNow * rules.emailsPerId)}/day</td>
                    </tr>
                  )}
                  {ramp.steps.map((s) => (
                    <tr key={s.on} className="border-b border-slate-100 last:border-0">
                      <td className="py-2 pr-4 whitespace-nowrap">
                        {fmt(s.on)} <span className="text-xs text-slate-400">in {daysBetween(today, s.on)}d</span>
                      </td>
                      <td className="py-2 pr-4 whitespace-nowrap">{plural(s.ids, "id")} · +{num(s.emails)}/day</td>
                      <td className="py-2 pr-4 text-xs text-slate-500">{s.domains.join(", ")}</td>
                      <td className="py-2 text-right tabular-nums">{num(s.capacityAfter)}/day</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {ramp.overLimit.length > 0 && (
            <p className="mt-4 rounded-lg bg-rose-50 p-3 text-sm text-rose-800">
              Over the limit: {ramp.overLimit.map((d) => `${d.domain} has ${d.count} ids (max ${d.allowedNow} right now)`).join("; ")}.
            </p>
          )}

          <div className="mt-5 border-t border-slate-100 pt-4">
            <label className="flex flex-wrap items-center gap-2 text-sm text-slate-600">
              Want to send
              <input
                type="number"
                min={0}
                value={target || ""}
                placeholder="e.g. 3000"
                onChange={(e) => {
                  const v = Math.max(0, Number(e.target.value) || 0);
                  setTarget(v);
                  save(K_TARGET, v);
                }}
                className="w-28 rounded-md border border-slate-300 px-2 py-1 text-sm text-slate-900 focus:border-indigo-500 focus:outline-none"
              />
              emails a day?
            </label>
            {target > 0 && (
              <p className="mt-2 text-sm text-slate-700">
                {target <= ramp.capacityNow ? (
                  <>You can already send that ({num(ramp.capacityNow)}/day today).</>
                ) : goal.buy === 0 ? (
                  <>Your current domains cover it once fully ramped (max {num(ramp.maxCapacity)}/day) — follow the plan above.</>
                ) : (
                  <>
                    Buy <b>{plural(goal.buy, "more domain")}</b> ({num(goal.gap)}/day short even when every current domain is full). With {rules.initialIdsPerDomain} ids each that&apos;s +{num(goal.dayOne)}/day
                    on day one and +{num(goal.full)}/day once all {rules.idsPerDomain} ids are added {rules.monthsBeforeFullDomain} month later.
                  </>
                )}
              </p>
            )}
          </div>
        </Card>

        <Card title="Domains & IDs" right={<span className="text-xs text-slate-400">From Smartlead · refreshed on every sync</span>}>
          <div className="overflow-x-auto">
            {domains.length === 0 ? (
              <p className="py-6 text-center text-sm text-slate-400">No domains yet. Click Sync Smartlead.</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs uppercase tracking-wide text-slate-400">
                    <th className="pb-2 font-medium">Domain</th>
                    <th className="pb-2 font-medium">Bought on</th>
                    <th className="pb-2 font-medium">IDs</th>
                    <th className="pb-2 font-medium">Emails / day</th>
                    <th className="pb-2 font-medium">Warmup</th>
                    <th className="pb-2 font-medium">Next step</th>
                  </tr>
                </thead>
                <tbody>
                  {domains.map((d) => {
                    const expanded = open.includes(d.domain);
                    return [
                      <tr key={d.domain} className="border-b border-slate-100">
                        <td className="py-2 pr-4">
                          <button onClick={() => toggle(d.domain)} className="flex items-center gap-1 text-left font-medium hover:text-indigo-600">
                            <span className="w-3 text-xs text-slate-400">{expanded ? "▾" : "▸"}</span>
                            {d.domain}
                          </button>
                        </td>
                        <td className="py-2 pr-4">
                          <input
                            type="date"
                            value={d.since ?? ""}
                            onChange={(e) => setPurchase(d.domain, e.target.value)}
                            title={d.sinceIsEstimate ? "Estimated from the earliest id. Set the real purchase date." : "Purchase date"}
                            className={`rounded-md border px-1.5 py-1 text-xs ${d.sinceIsEstimate ? "border-dashed border-amber-400 text-amber-700" : "border-slate-300"}`}
                          />
                        </td>
                        <td className="py-2 pr-4 whitespace-nowrap tabular-nums">
                          {d.count} / {rules.idsPerDomain}
                        </td>
                        <td className="py-2 pr-4 tabular-nums">{d.capacity}</td>
                        <td className="py-2 pr-4"><Rep value={d.reputation} /></td>
                        <td className="py-2">{nextStep(d)}</td>
                      </tr>,
                      expanded && (
                        <tr key={d.domain + "-ids"} className="border-b border-slate-100 bg-slate-50">
                          <td colSpan={6} className="px-6 py-3">
                            <table className="w-full text-xs">
                              <tbody>
                                {d.ids.map((i) => (
                                  <tr key={i.email}>
                                    <td className="py-1 pr-4">{i.email}</td>
                                    <td className="py-1 pr-4 text-slate-500">{i.createdOn ? fmt(i.createdOn) : "—"}</td>
                                    <td className="py-1 pr-4"><Rep value={i.reputation} /></td>
                                    <td className="py-1">{idNote(i)}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </td>
                        </tr>
                      ),
                    ];
                  })}
                </tbody>
              </table>
            )}
          </div>
          {domains.some((d) => d.sinceIsEstimate) && (
            <p className="mt-3 text-xs text-amber-700">Dashed dates are the day the domain's first id was added to Smartlead. If you bought the domain on a different day, set the real date so the ramp-up dates are right.</p>
          )}
          <p className="mt-2 text-xs text-slate-400">Purchase dates you set are saved in this browser.</p>
        </Card>
      </section>
    </div>
  );
}
