"use client";

import { useEffect, useState } from "react";
import { defaults, timezone } from "@/config/defaults";
import { DAY, capacity, costs, dayKey, timeline } from "@/lib/calc";
import type { Planned, Settings, SyncData } from "@/lib/calc";

const K_DATA = "sl-data", K_SETTINGS = "sl-settings", K_PLANNED = "sl-planned";

const labels: Record<keyof Settings, string> = {
  totalActiveInboxes: "Active inboxes (until first sync)",
  avgDailyLimitPerInbox: "Daily limit / inbox (until first sync)",
  sequenceLength: "Sequence length (emails)",
  followUpDropOffPercent: "Follow-up drop-off %",
  sendingDaysPerMonth: "Sending days / month",
  domainCostPerYearINR: "Domain cost / year (₹)",
  mailboxCostPerMonthINR: "Mailbox cost / month (₹)",
  smartleadCostPerClientPerMonthINR: "Smartlead cost / client / month (₹)",
  sourceLeadsDaysBeforeDeadline: "Source leads N days before campaign ends",
  leadsPerFreedInbox: "Leads to source per freed inbox",
  planningWindowDays: "Sourcing planner window (days)",
  firstCampaignYear: "Ignore campaigns created before (year)",
  runwayGreenAboveDays: "Runway green above (days)",
  runwayRedBelowDays: "Runway red below (days)",
};
const capacityKeys = ["totalActiveInboxes", "avgDailyLimitPerInbox", "sequenceLength", "followUpDropOffPercent", "sendingDaysPerMonth"] as const;
const otherKeys = (Object.keys(defaults) as (keyof Settings)[]).filter((k) => !(capacityKeys as readonly string[]).includes(k));

const tabs = ["Overview", "Campaigns", "Sourcing", "Replies", "Costs", "Inputs"] as const;
type Tab = (typeof tabs)[number];

const chip = {
  green: "bg-emerald-500/15 text-emerald-700 ring-emerald-500/30",
  amber: "bg-amber-500/15 text-amber-700 ring-amber-500/30",
  red: "bg-rose-500/15 text-rose-700 ring-rose-500/30",
  upcoming: "bg-violet-500/15 text-violet-700 ring-violet-500/30",
};
const bar = { green: "bg-emerald-500", amber: "bg-amber-500", red: "bg-rose-500" };
const palette = ["bg-indigo-500", "bg-sky-500", "bg-emerald-500", "bg-amber-500", "bg-rose-500", "bg-violet-500", "bg-teal-500", "bg-slate-400"];
const statusColor: Record<string, string> = { COMPLETED: "bg-emerald-500", INPROGRESS: "bg-sky-500", STARTED: "bg-indigo-500", BLOCKED: "bg-rose-500" };

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

function Card({ title, right, children, className = "" }: { title?: string; right?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={`rounded-xl border border-slate-200 bg-white p-5 shadow-sm ${className}`}>
      {title && (
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-700">{title}</h2>
          {right}
        </div>
      )}
      {children}
    </section>
  );
}

function Kpi({ label, value, sub, accent = "bg-indigo-500" }: { label: string; value: string; sub?: string; accent?: string }) {
  return (
    <div className="relative overflow-hidden rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className={`absolute inset-y-0 left-0 w-1 ${accent}`} />
      <div className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-1 text-3xl font-bold tracking-tight">{value}</div>
      {sub && <div className="mt-1 truncate text-sm text-slate-500">{sub}</div>}
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-lg bg-slate-50 p-3">
      <div className="text-xs text-slate-500">{label}</div>
      <div className="text-xl font-semibold">{value}</div>
      {sub && <div className="text-xs text-slate-400">{sub}</div>}
    </div>
  );
}

function Chip({ kind, children }: { kind: keyof typeof chip; children: React.ReactNode }) {
  return <span className={`whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${chip[kind]}`}>{children}</span>;
}

function Progress({ pct, color }: { pct: number; color: string }) {
  return (
    <div className="flex items-center gap-2">
      <div className="h-2 w-full min-w-[80px] rounded-full bg-slate-100">
        <div className={`h-2 rounded-full ${color}`} style={{ width: `${Math.min(100, pct)}%` }} />
      </div>
      <span className="w-10 text-right text-xs tabular-nums text-slate-500">{pct.toFixed(0)}%</span>
    </div>
  );
}

function Fields({ keys, s, onChange, cols = "sm:grid-cols-2 lg:grid-cols-3" }: { keys: readonly (keyof Settings)[]; s: Settings; onChange: (k: keyof Settings, v: number) => void; cols?: string }) {
  return (
    <div className={`grid gap-3 ${cols}`}>
      {keys.map((k) => (
        <label key={k} className="text-xs text-slate-500">
          {labels[k]}
          <input
            type="number"
            value={s[k]}
            onChange={(e) => onChange(k, Number(e.target.value))}
            className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm text-slate-900 focus:border-indigo-500 focus:outline-none"
          />
        </label>
      ))}
    </div>
  );
}

function Bars({ counts, total }: { counts: Record<string, number>; total: number }) {
  const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  if (!entries.length) return <p className="text-sm text-slate-400">No leads.</p>;
  return (
    <div className="space-y-2">
      {entries.map(([k, v], i) => (
        <div key={k}>
          <div className="flex justify-between text-xs">
            <span className="text-slate-700">{k}</span>
            <span className="tabular-nums text-slate-500">
              {num(v)} · {total ? ((v / total) * 100).toFixed(1) : 0}%
            </span>
          </div>
          <div className="mt-1 h-2 rounded-full bg-slate-100">
            <div className={`h-2 rounded-full ${palette[i % palette.length]}`} style={{ width: `${total ? (v / total) * 100 : 0}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}

export default function Home() {
  const [tab, setTab] = useState<Tab>("Overview");
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
  const campaigns = (data?.campaigns ?? []).filter((c) => new Date(c.createdAt).getFullYear() >= s.firstCampaignYear);
  const rows = data && now ? timeline(campaigns, s, now) : [];
  const cost = costs(s, mailboxes);

  const sourcing = rows
    .filter((r) => r.runway <= s.planningWindowDays)
    .map((r) => ({ ...r, sourceBy: r.est - s.sourceLeadsDaysBeforeDeadline * DAY, batch: s.leadsPerFreedInbox * r.inboxCount }));
  const plannedWithDates = planned.map((p) => {
    const launch = new Date(p.launchDate).getTime();
    return { ...p, launch, sourceBy: launch - s.sourceLeadsDaysBeforeDeadline * DAY };
  });
  const nextDeadline = [
    ...sourcing.map((r) => ({ at: r.sourceBy, sub: `~${num(r.batch)} leads for the ${r.inboxCount} inboxes freed after "${r.name}"` })),
    ...plannedWithDates.map((p) => ({ at: p.sourceBy, sub: `${num(p.listSize)} leads for planned "${p.name}"` })),
  ].sort((a, b) => a.at - b.at)[0];

  const timelineItems = [
    ...rows.map((r) => ({ at: r.est, row: r, plan: null })),
    ...plannedWithDates.map((p) => ({ at: p.launch, row: null, plan: p })),
  ].sort((a, b) => a.at - b.at);

  const aggregate: Record<string, number> = {};
  const leadStatus: Record<string, number> = {};
  const funnel = { sent: 0, opened: 0, replied: 0, bounced: 0 };
  let totalLeads = 0;
  for (const c of campaigns) {
    totalLeads += c.totalLeads;
    funnel.sent += c.stats.sent;
    funnel.opened += c.stats.opened;
    funnel.replied += c.stats.replied;
    funnel.bounced += c.stats.bounced;
    for (const [k, v] of Object.entries(c.categories)) aggregate[k] = (aggregate[k] ?? 0) + v;
    for (const [k, v] of Object.entries(c.leadStatus)) leadStatus[k] = (leadStatus[k] ?? 0) + v;
  }

  // Daily report: "today" = the day of the last sync, in the configured timezone
  const daily = data?.daily ?? [];
  const todayKey = data ? dayKey(new Date(data.syncedAt), timezone) : "";
  const sentToday = daily.find((d) => d.date === todayKey)?.sent ?? 0;
  const maxDaily = Math.max(1, cap.daily, ...daily.map((d) => d.sent));
  const soonest = rows[0];
  const stalledCount = rows.filter((r) => r.stalled).length;
  const pct = (a: number, b: number) => (b ? ((a / b) * 100).toFixed(1) + "%" : "0%");
  const actions = [
    ...sourcing.map((r) => ({
      late: r.sourceBy < now,
      text: `Source ~${num(r.batch)} new leads by ${date(r.sourceBy)}`,
      why: `${r.inboxCount} inboxes free up when "${r.name}" ends on ${date(r.est)}. Use the leads for whatever you launch next.`,
    })),
    ...plannedWithDates.map((p) => ({
      late: p.sourceBy < now,
      text: `Source ${num(p.listSize)} leads for planned campaign "${p.name}" by ${date(p.sourceBy)}`,
      why: `Launches ${date(p.launch)}`,
    })),
  ].sort((a, b) => Number(b.late) - Number(a.late));
  const empty = (msg: string) => <p className="py-6 text-center text-sm text-slate-400">{msg}</p>;

  const timelineTable = (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-left text-xs uppercase tracking-wide text-slate-400">
            <th className="pb-2 font-medium">Campaign</th>
            <th className="pb-2 font-medium">Completed</th>
            <th className="pb-2 font-medium">Est. completion</th>
            <th className="pb-2 text-right font-medium">Runway</th>
          </tr>
        </thead>
        <tbody>
          {timelineItems.map(({ row, plan }) =>
            row ? (
              <tr key={row.id} className="border-b border-slate-100 last:border-0">
                <td className="py-3 pr-4">
                  <div className="font-medium">{row.name}</div>
                  <div className="text-xs text-slate-400">{row.status} · {row.inboxCount} inboxes</div>
                </td>
                <td className="w-56 py-3 pr-4"><Progress pct={row.pct} color={bar[row.color]} /></td>
                <td className="py-3 pr-4 tabular-nums">{date(row.est)}</td>
                <td className="py-3 text-right">
                  <Chip kind={row.color}>{row.stalled ? `Stalled · ${-row.runway}d past` : `${row.runway} days`}</Chip>
                </td>
              </tr>
            ) : (
              <tr key={plan!.id} className="border-b border-slate-100 last:border-0">
                <td className="py-3 pr-4">
                  <div className="font-medium">{plan!.name}</div>
                  <div className="text-xs text-slate-400">Planned · {num(plan!.listSize)} leads</div>
                </td>
                <td className="py-3 pr-4 text-xs text-slate-400">not launched</td>
                <td className="py-3 pr-4 tabular-nums">{date(plan!.launch)}</td>
                <td className="py-3 text-right"><Chip kind="upcoming">Upcoming</Chip></td>
              </tr>
            ),
          )}
        </tbody>
      </table>
      {timelineItems.length === 0 && empty(data ? "No running campaigns." : "Click Sync to load your campaigns.")}
    </div>
  );

  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      {/* Sidebar */}
      <aside className="flex shrink-0 flex-col bg-slate-900 text-slate-300 md:sticky md:top-0 md:h-screen md:w-56">
        <div className="px-5 py-5">
          <div className="text-lg font-bold text-white">Myntmore</div>
          <div className="text-xs text-slate-500">Cold email ops</div>
        </div>
        <nav className="flex gap-1 overflow-x-auto px-3 pb-3 md:flex-1 md:flex-col md:overflow-visible">
          {tabs.map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`whitespace-nowrap rounded-lg px-3 py-2 text-left text-sm transition ${tab === t ? "bg-indigo-500 text-white" : "hover:bg-slate-800"}`}
            >
              {t}
            </button>
          ))}
        </nav>
        <div className="border-t border-slate-800 p-4">
          <button onClick={sync} disabled={syncing} className="w-full rounded-lg bg-white py-2 text-sm font-semibold text-slate-900 disabled:opacity-60">
            {syncing ? "Syncing…" : "Sync Smartlead"}
          </button>
          <div className="mt-2 text-xs text-slate-500">{data ? `Last synced ${new Date(data.syncedAt).toLocaleString("en-GB")}` : "Never synced"}</div>
        </div>
      </aside>

      {/* Main */}
      <main className="min-w-0 flex-1 space-y-5 p-5 md:p-8">
        <header>
          <h1 className="text-2xl font-bold">{tab}</h1>
          <p className="text-sm text-slate-500">{data ? `Last synced ${new Date(data.syncedAt).toLocaleString("en-GB")}` : "Not synced yet. Click Sync Smartlead."}</p>
        </header>
        {error && <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">{error}</div>}

        {tab === "Overview" && (
          <>
            <div className="rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 p-6 text-white shadow-sm">
              <div className="text-xs font-medium uppercase tracking-wide text-indigo-200">The big picture</div>
              <p className="mt-2 text-lg leading-relaxed">
                You send up to <b>{num(cap.daily)} emails a day</b>
                {mailboxes.length > 0 && <> from <b>{mailboxes.length} mailboxes</b></>}. That reaches about <b>{num(cap.netProspects)} new prospects a month</b>, so you
                need to feed in <b>{num(cap.leadsPerDay)} fresh leads every day</b>.{" "}
                {data ? (
                  <>
                    Right now <b>{rows.length} campaigns</b> are running
                    {stalledCount > 0 && <>, <b>{stalledCount}</b> of them past their projected end date</>}
                    {actions.length > 0 ? <>, and <b>{actions.length} lead-sourcing {actions.length === 1 ? "task is" : "tasks are"} coming up</b>.</> : <>, and nothing needs sourcing yet.</>}
                  </>
                ) : (
                  <>Click Sync Smartlead to load your campaigns.</>
                )}
              </p>
            </div>

            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <Kpi label="NET prospects / month" value={num(cap.netProspects)} sub={`${num(cap.leadsPerDay)} new leads needed / day`} />
              <Kpi
                label="Next lead-sourcing deadline"
                accent="bg-amber-500"
                value={nextDeadline ? date(nextDeadline.at) : "\u2014"}
                sub={nextDeadline ? nextDeadline.sub : "Nothing inside the planning window"}
              />
              <Kpi
                label="Soonest-ending campaign"
                accent={soonest ? bar[soonest.color] : "bg-slate-300"}
                value={soonest ? date(soonest.est) : "\u2014"}
                sub={soonest ? `${soonest.name} \u00b7 ${soonest.runway < 0 ? `stalled ${-soonest.runway}d past` : `${soonest.runway} days left`}` : data ? "No running campaigns" : "Sync to load"}
              />
              <Kpi label="Monthly infra cost" accent="bg-emerald-500" value={data ? inr(cost.total) : "\u2014"} sub={data ? `${cost.boxes} mailboxes \u00b7 ${cost.domains} domains` : "Sync to load"} />
            </div>

            <Card
              title="Today's sending"
              right={data && <span className="text-xs text-slate-400">as of {new Date(data.syncedAt).toLocaleTimeString("en-GB", { timeZone: timezone, hour: "2-digit", minute: "2-digit" })} (last sync)</span>}
            >
              {data?.dailyError && daily.length === 0 ? (
                <p className="text-sm text-amber-700">Couldn&apos;t load the daily report: {data.dailyError}</p>
              ) : !data ? (
                empty("Sync to see how many emails went out today.")
              ) : (
                <div className="grid gap-6 lg:grid-cols-3">
                  <div>
                    <div className="text-xs text-slate-500">Emails sent today so far</div>
                    <div className="text-4xl font-bold tracking-tight">{num(sentToday)}</div>
                    <div className="mt-3"><Progress pct={cap.daily ? (sentToday / cap.daily) * 100 : 0} color="bg-indigo-500" /></div>
                    <div className="mt-1 text-xs text-slate-500">of {num(cap.daily)} daily capacity</div>
                  </div>
                  <div className="lg:col-span-2">
                    <div className="mb-2 text-xs text-slate-500">Last {daily.length} days</div>
                    <div className="flex h-28 items-end gap-1">
                      {daily.map((d) => (
                        <div key={d.date} className="flex flex-1 flex-col items-center justify-end gap-1" title={`${d.date}: ${num(d.sent)} sent`}>
                          <span className="text-[10px] tabular-nums text-slate-500">{num(d.sent)}</span>
                          <div className={`w-full rounded-t ${d.date === todayKey ? "bg-indigo-500" : "bg-slate-300"}`} style={{ height: `${(d.sent / maxDaily) * 80}px` }} />
                          <span className="text-[10px] text-slate-400">{new Date(d.date + "T00:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "short" })}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </Card>

            <Card title="Capacity (change the numbers in the Inputs tab)">
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
                <Stat label="Total daily capacity" value={num(cap.daily)} sub={cap.fromSync ? "from synced mailboxes" : "from inputs"} />
                <Stat label="Monthly capacity" value={num(cap.monthly)} />
                <Stat label="Effective emails / prospect" value={cap.effective.toFixed(2)} />
                <Stat label="NET prospects / month" value={num(cap.netProspects)} />
                <Stat label="New leads needed / day" value={num(cap.leadsPerDay)} />
              </div>
            </Card>

            <div className="grid gap-5 xl:grid-cols-3">
              <Card title="What to do next" className="xl:col-span-2">
                {actions.length === 0 ? (
                  empty(data ? "Nothing urgent. No campaign ends inside your planning window." : "Sync to see your to-do list.")
                ) : (
                  <ul className="space-y-3">
                    {actions.map((a, i) => (
                      <li key={i} className="flex items-start gap-3">
                        <span className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${a.late ? "bg-rose-500" : "bg-amber-500"}`} />
                        <div>
                          <div className="text-sm font-medium">{a.text} {a.late && <Chip kind="red">Overdue</Chip>}</div>
                          <div className="text-xs text-slate-500">{a.why}</div>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
                {stalledCount > 0 && (
                  <p className="mt-4 rounded-lg bg-rose-50 p-3 text-sm text-rose-800">
                    {stalledCount} {stalledCount === 1 ? "campaign is" : "campaigns are"} past the projected end date but still have leads in progress. Check them in the Campaigns tab.
                  </p>
                )}
              </Card>
              <Card title="Sending results (all running campaigns)">
                <div className="grid grid-cols-2 gap-3">
                  <Stat label="Leads loaded" value={num(totalLeads)} />
                  <Stat label="Emails sent" value={num(funnel.sent)} />
                  <Stat label="Opened" value={num(funnel.opened)} sub={pct(funnel.opened, funnel.sent) + " of sent"} />
                  <Stat label="Replied" value={num(funnel.replied)} sub={pct(funnel.replied, funnel.sent) + " of sent"} />
                  <Stat label="Bounced" value={num(funnel.bounced)} sub={pct(funnel.bounced, funnel.sent) + " of sent"} />
                  <Stat label="Mailboxes" value={num(mailboxes.length)} sub={`${cost.domains} domains`} />
                </div>
              </Card>
            </div>

            <div className="grid gap-5 xl:grid-cols-3">
              <Card title="Campaign runway · soonest-ending first" className="xl:col-span-2">{timelineTable}</Card>
              <div className="space-y-5">
                <Card title="Lead status">
                  {totalLeads ? (
                    <>
                      <div className="flex h-3 overflow-hidden rounded-full bg-slate-100">
                        {Object.entries(leadStatus).map(([k, v]) => (
                          <div key={k} className={statusColor[k] ?? "bg-slate-400"} style={{ width: `${(v / totalLeads) * 100}%` }} title={k} />
                        ))}
                      </div>
                      <ul className="mt-4 space-y-1.5 text-sm">
                        {Object.entries(leadStatus).map(([k, v]) => (
                          <li key={k} className="flex items-center justify-between">
                            <span className="flex items-center gap-2"><i className={`h-2.5 w-2.5 rounded-full ${statusColor[k] ?? "bg-slate-400"}`} />{k}</span>
                            <span className="tabular-nums text-slate-500">{num(v)}</span>
                          </li>
                        ))}
                      </ul>
                    </>
                  ) : (
                    empty("Sync to see lead status.")
                  )}
                </Card>
                <Card title="Reply categories">
                  {totalLeads ? <Bars counts={aggregate} total={totalLeads} /> : empty("Sync to see replies.")}
                </Card>
              </div>
            </div>
          </>
        )}

        {tab === "Campaigns" && <Card title="Campaign timeline · soonest-ending first">{timelineTable}</Card>}

        {tab === "Sourcing" && (
          <>
            <Card title={`Inboxes freeing up · campaigns ending within ${s.planningWindowDays} days`}>
              {sourcing.length === 0 ? (
                empty("Nothing to source right now.")
              ) : (
                <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                  {sourcing.map((r) => (
                    <div key={r.id} className="rounded-lg border border-slate-200 p-4">
                      <div className="flex items-start justify-between gap-2">
                        <div className="font-medium"><span className="text-xs font-normal text-slate-400">Frees up after</span><br />{r.name}</div>
                        <Chip kind={r.color}>{r.stalled ? "Stalled" : `${r.runway}d`}</Chip>
                      </div>
                      <div className="mt-3 text-xs text-slate-500">Source leads by</div>
                      <div className="text-xl font-bold">{date(r.sourceBy)}</div>
                      <div className="mt-2 text-sm text-slate-600">
                        <b>~{num(r.batch)}</b> leads for your next campaign <span className="text-slate-400">({r.inboxCount} inboxes × {s.leadsPerFreedInbox})</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Card>
            <Card title="Planned campaigns (not in Smartlead yet)">
              {plannedWithDates.length > 0 && (
                <table className="mb-4 w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-xs uppercase tracking-wide text-slate-400">
                      <th className="pb-2 font-medium">Name</th>
                      <th className="pb-2 font-medium">Launch</th>
                      <th className="pb-2 font-medium">Steps</th>
                      <th className="pb-2 font-medium">List size</th>
                      <th className="pb-2 font-medium">Source by</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {plannedWithDates.map((p) => (
                      <tr key={p.id} className="border-b border-slate-100 last:border-0">
                        <td className="py-2 font-medium">{p.name}</td>
                        <td className="py-2">{date(p.launch)}</td>
                        <td className="py-2">{p.sequenceLength}</td>
                        <td className="py-2">{num(p.listSize)}</td>
                        <td className="py-2 font-medium">{date(p.sourceBy)}</td>
                        <td className="py-2 text-right">
                          <button onClick={() => savePlanned(planned.filter((x) => x.id !== p.id))} className="text-xs text-rose-600">remove</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              <form
                className="flex flex-wrap items-end gap-3 text-sm"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!form.name || !form.launchDate) return;
                  savePlanned([...planned, { ...form, id: String(Date.now()) }]);
                  setForm({ ...form, name: "", launchDate: "", listSize: 0 });
                }}
              >
                <label className="text-xs text-slate-500">Name<input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="mt-1 block rounded-md border border-slate-300 px-2 py-1.5 text-sm text-slate-900" /></label>
                <label className="text-xs text-slate-500">Launch date<input type="date" value={form.launchDate} onChange={(e) => setForm({ ...form, launchDate: e.target.value })} className="mt-1 block rounded-md border border-slate-300 px-2 py-1.5 text-sm text-slate-900" /></label>
                <label className="text-xs text-slate-500">Sequence length<input type="number" value={form.sequenceLength} onChange={(e) => setForm({ ...form, sequenceLength: Number(e.target.value) })} className="mt-1 block w-28 rounded-md border border-slate-300 px-2 py-1.5 text-sm text-slate-900" /></label>
                <label className="text-xs text-slate-500">List size<input type="number" value={form.listSize || ""} onChange={(e) => setForm({ ...form, listSize: Number(e.target.value) })} className="mt-1 block w-28 rounded-md border border-slate-300 px-2 py-1.5 text-sm text-slate-900" /></label>
                <button className="rounded-lg bg-indigo-500 px-4 py-2 text-sm font-medium text-white">Add campaign</button>
              </form>
            </Card>
          </>
        )}

        {tab === "Replies" && (
          <>
            <Card title={`All campaigns · ${num(totalLeads)} leads`}>
              {totalLeads ? <Bars counts={aggregate} total={totalLeads} /> : empty("Click Sync to load reply categories.")}
            </Card>
            <div className="grid gap-5 lg:grid-cols-2">
              {campaigns.map((c) => (
                <Card key={c.id} title={c.name} right={<span className="text-xs text-slate-400">{c.status} · {num(c.totalLeads)} leads</span>}>
                  <div className="mb-4 grid grid-cols-4 gap-2 text-center">
                    <Stat label="Sent" value={num(c.stats.sent)} />
                    <Stat label="Opened" value={num(c.stats.opened)} />
                    <Stat label="Replied" value={num(c.stats.replied)} />
                    <Stat label="Bounced" value={num(c.stats.bounced)} />
                  </div>
                  <Bars counts={c.categories} total={c.totalLeads} />
                </Card>
              ))}
            </div>
          </>
        )}

        {tab === "Costs" &&
          (data ? (
            <>
              <div className="grid gap-4 sm:grid-cols-3">
                <Kpi label="Total monthly infra cost" value={inr(cost.total)} accent="bg-emerald-500" />
                <Kpi label="Cost per mailbox" value={inr(cost.perMailbox)} sub={`${cost.boxes} mailboxes`} />
                <Kpi label="Cost per domain" value={inr(cost.perDomain)} sub={`${cost.domains} domains`} accent="bg-sky-500" />
              </div>
              <Card title="Monthly breakdown">
                <table className="w-full text-sm">
                  <tbody>
                    {[
                      [`Domains (${cost.domains} × ${inr(s.domainCostPerYearINR)} / 12)`, (cost.domains * s.domainCostPerYearINR) / 12],
                      [`Mailboxes (${cost.boxes} × ${inr(s.mailboxCostPerMonthINR)})`, cost.boxes * s.mailboxCostPerMonthINR],
                      ["Smartlead", s.smartleadCostPerClientPerMonthINR],
                    ].map(([k, v]) => (
                      <tr key={k as string} className="border-b border-slate-100">
                        <td className="py-2">{k}</td>
                        <td className="py-2 text-right tabular-nums">{inr(v as number)}</td>
                      </tr>
                    ))}
                    <tr className="font-semibold">
                      <td className="py-2">Total</td>
                      <td className="py-2 text-right tabular-nums">{inr(cost.total)}</td>
                    </tr>
                  </tbody>
                </table>
              </Card>
            </>
          ) : (
            <Card>{empty("Click Sync to load mailbox and domain counts.")}</Card>
          ))}

        {tab === "Inputs" && (
          <>
            <Card title="Capacity inputs" right={<button onClick={reset} className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium">Reset all to defaults</button>}>
              <Fields keys={capacityKeys} s={s} onChange={changeSetting} />
              <p className="mt-3 text-xs text-slate-400">Once you have synced, daily capacity comes from your real mailboxes. Active inboxes and daily limit are only used before the first sync.</p>
            </Card>
            <Card title="Costs, sourcing and display">
              <Fields keys={otherKeys} s={s} onChange={changeSetting} />
              <p className="mt-4 text-xs text-slate-400">Defaults live in config/defaults.ts. Changes here are saved in this browser.</p>
            </Card>
          </>
        )}
      </main>
    </div>
  );
}
