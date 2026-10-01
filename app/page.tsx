"use client";

import { useEffect, useState } from "react";
import { defaults } from "@/config/defaults";
import { DAY, capacity, costs, timeline } from "@/lib/calc";
import type { Planned, Settings, SyncData } from "@/lib/calc";

const K_DATA = "sl-data", K_SETTINGS = "sl-settings", K_PLANNED = "sl-planned";

const labels: Record<keyof Settings, string> = {
  totalActiveInboxes: "Active inboxes (used until first sync)",
  avgDailyLimitPerInbox: "Avg daily limit / inbox (used until first sync)",
  sequenceLength: "Sequence length (emails)",
  followUpDropOffPercent: "Follow-up drop-off %",
  sendingDaysPerMonth: "Sending days / month",
  domainCostPerYearINR: "Domain cost / year (₹)",
  mailboxCostFirstYearINR: "Mailbox cost, first year (₹, one-off per mailbox)",
  mailboxCostPerMonthINR: "Mailbox cost / month (₹)",
  smartleadCostPerClientPerMonthINR: "Smartlead cost / client / month (₹)",
  sourceLeadsDaysBeforeDeadline: "Source leads N days before campaign ends",
  leadsPerFreedInbox: "Leads to source per freed inbox",
  planningWindowDays: "Sourcing planner window (days)",
  runwayGreenAboveDays: "Runway green above (days)",
  runwayRedBelowDays: "Runway red below (days)",
};
const capacityKeys = ["totalActiveInboxes", "avgDailyLimitPerInbox", "sequenceLength", "followUpDropOffPercent", "sendingDaysPerMonth"] as const;
const otherKeys = (Object.keys(defaults) as (keyof Settings)[]).filter((k) => !(capacityKeys as readonly string[]).includes(k));

const chip = {
  green: "bg-green-100 text-green-800",
  amber: "bg-amber-100 text-amber-800",
  red: "bg-red-100 text-red-800",
  upcoming: "bg-violet-100 text-violet-800",
};
const bar = { green: "bg-green-500", amber: "bg-amber-500", red: "bg-red-500" };

const date = (ms: number) => new Date(ms).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
const inr = (n: number) => "₹" + Math.round(n).toLocaleString("en-IN");
const num = (n: number) => Math.round(n).toLocaleString("en-IN");

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

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <details className="rounded-lg border bg-white">
      <summary className="cursor-pointer select-none px-4 py-3 font-semibold">{title}</summary>
      <div className="border-t px-4 py-4">{children}</div>
    </details>
  );
}

function Big({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-lg border bg-white p-4">
      <div className="text-sm text-slate-500">{label}</div>
      <div className="text-3xl font-bold">{value}</div>
      {sub && <div className="mt-1 truncate text-sm text-slate-500">{sub}</div>}
    </div>
  );
}

function Fields({ keys, s, onChange }: { keys: readonly (keyof Settings)[]; s: Settings; onChange: (k: keyof Settings, v: number) => void }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {keys.map((k) => (
        <label key={k} className="text-sm">
          <span className="text-slate-600">{labels[k]}</span>
          <input
            type="number"
            value={s[k]}
            onChange={(e) => onChange(k, Number(e.target.value))}
            className="mt-1 w-full rounded border px-2 py-1"
          />
        </label>
      ))}
    </div>
  );
}

export default function Home() {
  const [s, setS] = useState<Settings>(defaults);
  const [data, setData] = useState<SyncData | null>(null);
  const [planned, setPlanned] = useState<Planned[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState({ name: "", launchDate: "", sequenceLength: defaults.sequenceLength, listSize: 0 });
  const [now, setNow] = useState(0);

  useEffect(() => {
    setS({ ...defaults, ...load<Partial<Settings>>(K_SETTINGS, {}) });
    setData(load<SyncData | null>(K_DATA, null));
    setPlanned(load<Planned[]>(K_PLANNED, []));
    setNow(Date.now());
  }, []);

  function changeSetting(k: keyof Settings, v: number) {
    const next = { ...s, [k]: v };
    setS(next);
    save(K_SETTINGS, next);
  }
  function reset() {
    setS(defaults);
    save(K_SETTINGS, defaults);
  }
  function savePlanned(list: Planned[]) {
    setPlanned(list);
    save(K_PLANNED, list);
  }
  async function sync() {
    setSyncing(true);
    setError("");
    try {
      const res = await fetch("/api/sync", { method: "POST" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Sync failed");
      setData(json);
      save(K_DATA, json);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Sync failed");
    }
    setSyncing(false);
  }

  const mailboxes = data?.mailboxes ?? [];
  const cap = capacity(s, mailboxes);
  const rows = data && now ? timeline(data.campaigns, s, now) : [];
  const cost = costs(s, mailboxes);

  // Sourcing planner: live campaigns inside the window + manual planned campaigns
  const sourcing = rows
    .filter((r) => r.runway <= s.planningWindowDays)
    .map((r) => ({ ...r, sourceBy: r.est - s.sourceLeadsDaysBeforeDeadline * DAY, batch: s.leadsPerFreedInbox * r.inboxCount }));
  const plannedWithDates = planned.map((p) => {
    const launch = new Date(p.launchDate).getTime();
    return { ...p, launch, sourceBy: launch - s.sourceLeadsDaysBeforeDeadline * DAY };
  });
  const nextDeadline = [
    ...sourcing.map((r) => ({ name: r.name, at: r.sourceBy })),
    ...plannedWithDates.map((p) => ({ name: p.name, at: p.sourceBy })),
  ].sort((a, b) => a.at - b.at)[0];

  // Timeline: live + planned on one list, soonest first
  const timelineItems = [
    ...rows.map((r) => ({ at: r.est, row: r, plan: null })),
    ...plannedWithDates.map((p) => ({ at: p.launch, row: null, plan: p })),
  ].sort((a, b) => a.at - b.at);

  // Reply categories
  const aggregate: Record<string, number> = {};
  let aggregateTotal = 0;
  for (const c of data?.campaigns ?? []) {
    aggregateTotal += c.totalLeads;
    for (const [k, v] of Object.entries(c.categories)) aggregate[k] = (aggregate[k] ?? 0) + v;
  }
  const catTable = (counts: Record<string, number>, total: number) => (
    <table className="w-full text-sm">
      <tbody>
        {Object.entries(counts)
          .sort((a, b) => b[1] - a[1])
          .map(([k, v]) => (
            <tr key={k} className="border-b last:border-0">
              <td className="py-1">{k}</td>
              <td className="py-1 text-right">{v}</td>
              <td className="w-16 py-1 text-right text-slate-500">{total ? ((v / total) * 100).toFixed(1) : 0}%</td>
            </tr>
          ))}
      </tbody>
    </table>
  );

  const soonest = rows[0];

  return (
    <main className="mx-auto max-w-5xl space-y-4 p-4">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-bold">Myntmore · Cold Email Dashboard</h1>
        <div className="flex items-center gap-3 text-sm text-slate-600">
          <span>{data ? `Last synced ${new Date(data.syncedAt).toLocaleString("en-GB")}` : "Never synced"}</span>
          <button onClick={sync} disabled={syncing} className="rounded bg-slate-900 px-4 py-2 text-white disabled:opacity-50">
            {syncing ? "Syncing…" : "Sync"}
          </button>
        </div>
      </header>
      {error && <div className="rounded border border-red-300 bg-red-50 p-3 text-sm text-red-800">{error}</div>}

      <div className="grid gap-3 sm:grid-cols-3">
        <Big label="NET unique prospects / month" value={num(cap.netProspects)} />
        <Big
          label="Next sourcing deadline"
          value={nextDeadline ? date(nextDeadline.at) : "—"}
          sub={nextDeadline ? nextDeadline.name : "Nothing inside the planning window"}
        />
        <Big
          label="Soonest-ending campaign"
          value={soonest ? date(soonest.est) : "—"}
          sub={soonest ? `${soonest.name} · ${soonest.runway} days` : data ? "No running campaigns" : "Sync to load"}
        />
      </div>

      <Section title="1. Capacity calculator">
        <Fields keys={capacityKeys} s={s} onChange={changeSetting} />
        <div className="mt-4 grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
          <Big label="Total daily capacity" value={num(cap.daily)} sub={cap.fromSync ? "from synced mailboxes" : "from inputs"} />
          <Big label="Monthly capacity" value={num(cap.monthly)} />
          <Big label="Effective emails / prospect" value={cap.effective.toFixed(2)} />
          <Big label="NET prospects / month" value={num(cap.netProspects)} />
          <Big label="New leads needed / day" value={num(cap.leadsPerDay)} />
        </div>
      </Section>

      <Section title="2. Campaign timeline">
        {timelineItems.length === 0 && <p className="text-sm text-slate-500">{data ? "No running campaigns." : "Sync to load campaigns."}</p>}
        <div className="space-y-3">
          {timelineItems.map(({ row, plan }) =>
            row ? (
              <div key={row.id}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="font-medium">
                    {row.name} <span className="text-xs text-slate-500">{row.status}</span>
                  </div>
                  <div className="flex items-center gap-2 text-sm">
                    <span>{date(row.est)}</span>
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${chip[row.color]}`}>
                      {row.stalled ? `Stalled · ${-row.runway}d past` : `${row.runway} days`}
                    </span>
                  </div>
                </div>
                <div className="mt-1 flex items-center gap-2">
                  <div className="h-2 flex-1 rounded bg-slate-200">
                    <div className={`h-2 rounded ${bar[row.color]}`} style={{ width: `${row.pct}%` }} />
                  </div>
                  <span className="w-12 text-right text-xs text-slate-600">{row.pct.toFixed(0)}%</span>
                </div>
              </div>
            ) : (
              <div key={plan!.id} className="flex flex-wrap items-center justify-between gap-2">
                <div className="font-medium">{plan!.name}</div>
                <div className="flex items-center gap-2 text-sm">
                  <span>launches {date(plan!.launch)}</span>
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${chip.upcoming}`}>Upcoming</span>
                </div>
              </div>
            ),
          )}
        </div>
      </Section>

      <Section title="3. Lead sourcing planner">
        <h3 className="mb-2 text-sm font-semibold text-slate-600">Campaigns ending within {s.planningWindowDays} days</h3>
        {sourcing.length === 0 && <p className="text-sm text-slate-500">Nothing to source right now.</p>}
        <div className="space-y-2">
          {sourcing.map((r) => (
            <div key={r.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
              <span className="font-medium">{r.name}</span>
              <span>
                Source by <b>{date(r.sourceBy)}</b> · {num(r.batch)} leads ({r.inboxCount} inboxes freeing × {s.leadsPerFreedInbox})
              </span>
            </div>
          ))}
        </div>

        <h3 className="mb-2 mt-6 text-sm font-semibold text-slate-600">Planned campaigns (not in Smartlead yet)</h3>
        <div className="space-y-2">
          {plannedWithDates.map((p) => (
            <div key={p.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
              <span className="font-medium">{p.name}</span>
              <span>
                Launch {date(p.launch)} · {p.sequenceLength} steps · {num(p.listSize)} leads · source by <b>{date(p.sourceBy)}</b>
                <button onClick={() => savePlanned(planned.filter((x) => x.id !== p.id))} className="ml-3 text-red-600">
                  remove
                </button>
              </span>
            </div>
          ))}
        </div>
        <form
          className="mt-3 flex flex-wrap items-end gap-2 text-sm"
          onSubmit={(e) => {
            e.preventDefault();
            if (!form.name || !form.launchDate) return;
            savePlanned([...planned, { ...form, id: String(Date.now()) }]);
            setForm({ ...form, name: "", launchDate: "", listSize: 0 });
          }}
        >
          <input placeholder="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="rounded border px-2 py-1" />
          <input type="date" value={form.launchDate} onChange={(e) => setForm({ ...form, launchDate: e.target.value })} className="rounded border px-2 py-1" />
          <input type="number" title="Sequence length" value={form.sequenceLength} onChange={(e) => setForm({ ...form, sequenceLength: Number(e.target.value) })} className="w-20 rounded border px-2 py-1" />
          <input type="number" title="List size" placeholder="List size" value={form.listSize || ""} onChange={(e) => setForm({ ...form, listSize: Number(e.target.value) })} className="w-28 rounded border px-2 py-1" />
          <button className="rounded bg-slate-900 px-3 py-1 text-white">Add</button>
        </form>
      </Section>

      <Section title="4. Campaign breakdown (reply categories)">
        {!data && <p className="text-sm text-slate-500">Sync to load campaigns.</p>}
        {data && (
          <>
            <div className="mb-3 rounded border p-3">
              <div className="mb-1 font-medium">All campaigns · {num(aggregateTotal)} leads</div>
              {catTable(aggregate, aggregateTotal)}
            </div>
            {data.campaigns.map((c) => (
              <details key={c.id} className="border-b py-2 last:border-0">
                <summary className="cursor-pointer text-sm">
                  {c.name} <span className="text-xs text-slate-500">{c.status} · {num(c.totalLeads)} leads</span>
                </summary>
                <div className="mt-2 text-xs text-slate-500">
                  Sent {num(c.stats.sent)} · Opened {num(c.stats.opened)} · Replied {num(c.stats.replied)} · Bounced {num(c.stats.bounced)}
                </div>
                <div className="mt-2">{catTable(c.categories, c.totalLeads)}</div>
              </details>
            ))}
          </>
        )}
      </Section>

      <Section title="5. Cost dashboard">
        {!data && <p className="text-sm text-slate-500">Sync to load mailbox and domain counts.</p>}
        {data && (
          <div className="grid gap-3 sm:grid-cols-3">
            <Big label="Total monthly infra cost" value={inr(cost.total)} sub={`${cost.boxes} mailboxes · ${cost.domains} domains`} />
            <Big label="Cost per mailbox / month" value={inr(cost.perMailbox)} />
            <Big label="Cost per domain / month" value={inr(cost.perDomain)} />
          </div>
        )}
        {data && <p className="mt-3 text-xs text-slate-500">Mailbox first-year cost ({inr(cost.firstYearMailboxes)} across all mailboxes) is not included in the monthly figure.</p>}
      </Section>

      <Section title="Settings (all tunable numbers)">
        <Fields keys={otherKeys} s={s} onChange={changeSetting} />
        <button onClick={reset} className="mt-4 rounded border px-3 py-1 text-sm">
          Reset to defaults
        </button>
        <p className="mt-2 text-xs text-slate-500">Defaults live in config/defaults.ts. Capacity inputs are in section 1.</p>
      </Section>
    </main>
  );
}
