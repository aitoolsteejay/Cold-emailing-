import { defaults } from "@/config/defaults";

export type Settings = typeof defaults;

export type Campaign = {
  id: number;
  name: string;
  status: string;
  createdAt: string;
  stepDelays: number[]; // delayInDays per sequence step
  startDate: string | null; // earliest sent time, null if nothing sent yet
  totalLeads: number;
  leadStatus: Record<string, number>; // STARTED / INPROGRESS / COMPLETED / BLOCKED ...
  categories: Record<string, number>; // category name -> lead count, as tagged in Smartlead
  inboxCount: number; // mailboxes attached to this campaign
  stats: { sent: number; opened: number; replied: number; bounced: number };
};
export type Mailbox = { email: string; domain: string; dailyLimit: number };
export type SyncData = { syncedAt: string; campaigns: Campaign[]; mailboxes: Mailbox[] };
export type Planned = { id: string; name: string; launchDate: string; sequenceLength: number; listSize: number };

export const DAY = 86400000;

export function capacity(s: Settings, mailboxes: Mailbox[]) {
  const daily = mailboxes.length
    ? mailboxes.reduce((sum, m) => sum + m.dailyLimit, 0)
    : s.totalActiveInboxes * s.avgDailyLimitPerInbox;
  const monthly = daily * s.sendingDaysPerMonth;
  // Email 1 always sends; only follow-ups are reduced by drop-off.
  const effective = 1 + (s.sequenceLength - 1) * (1 - s.followUpDropOffPercent / 100);
  return {
    daily,
    monthly,
    effective,
    netProspects: monthly / effective,
    leadsPerDay: daily / effective,
    fromSync: mailboxes.length > 0,
  };
}

export type Row = Campaign & {
  pending: number;
  completed: number;
  pct: number;
  est: number; // estimated completion (ms)
  runway: number; // days left, negative = past
  stalled: boolean;
  color: "green" | "amber" | "red";
};

// Only campaigns that are running (ACTIVE/PAUSED) and still have leads in flight.
export function timeline(campaigns: Campaign[], s: Settings, now: number): Row[] {
  const rows: Row[] = [];
  for (const c of campaigns) {
    if (c.status !== "ACTIVE" && c.status !== "PAUSED") continue;
    const pending = (c.leadStatus.STARTED ?? 0) + (c.leadStatus.INPROGRESS ?? 0);
    if (pending === 0) continue;
    const completed = c.leadStatus.COMPLETED ?? 0;
    const start = new Date(c.startDate ?? c.createdAt).getTime();
    const est = start + c.stepDelays.reduce((a, b) => a + b, 0) * DAY;
    const runway = Math.ceil((est - now) / DAY);
    const stalled = runway < 0;
    const color = stalled || runway < s.runwayRedBelowDays ? "red" : runway <= s.runwayGreenAboveDays ? "amber" : "green";
    rows.push({ ...c, pending, completed, pct: c.totalLeads ? (completed / c.totalLeads) * 100 : 0, est, runway, stalled, color });
  }
  return rows.sort((a, b) => a.est - b.est);
}

export function costs(s: Settings, mailboxes: Mailbox[]) {
  const domains = new Set(mailboxes.map((m) => m.domain)).size;
  const boxes = mailboxes.length;
  const total = (domains * s.domainCostPerYearINR) / 12 + boxes * s.mailboxCostPerMonthINR + s.smartleadCostPerClientPerMonthINR;
  return {
    domains,
    boxes,
    total,
    perMailbox: boxes ? total / boxes : 0,
    perDomain: domains ? total / domains : 0,
    firstYearMailboxes: boxes * s.mailboxCostFirstYearINR,
  };
}
