// Every number the app's formulas depend on lives here.
// Edit here, or override at runtime in the UI (saved to localStorage; "Reset to defaults" reloads this).
export const defaults = {
  // Capacity
  totalActiveInboxes: 56,
  avgDailyLimitPerInbox: 25,
  sequenceLength: 4, // emails per prospect
  followUpDropOffPercent: 7, // %
  sendingDaysPerMonth: 30, // currently sending 7 days/week

  // Cost dashboard
  domainCostPerYearINR: 900,
  mailboxCostPerMonthINR: 325,
  smartleadCostPerClientPerMonthINR: 2000,

  // Lead sourcing
  sourceLeadsDaysBeforeDeadline: 7, // I source exactly 1 week before I need them, no standing inventory
  leadsPerFreedInbox: 150, // leads to source per inbox that frees up when a campaign ends
  planningWindowDays: 14, // campaigns finishing within this many days show up in the sourcing planner

  // Which campaigns to show
  firstCampaignYear: 2026, // campaigns created before this year are ignored everywhere

  // Campaign runway colors (days left until estimated completion)
  runwayGreenAboveDays: 14, // green above this
  runwayRedBelowDays: 7, // red below this, amber in between
};
