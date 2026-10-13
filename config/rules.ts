// The fixed rules every number in the app is calculated from.
// Change them here; the UI does not override them.
export const rules = {
  // Lead sourcing
  leadsPerId: 150, // leads to source for every id that is not in a campaign
  leadsTolerancePercent: 5, // +/- range shown around the lead count

  // Domains and ids
  emailsPerId: 25, // emails per id per day
  idsPerDomain: 4, // max ids on one domain (4 x 25 = 100 emails / day)
  initialIdsPerDomain: 2, // ids allowed in the first period after buying a domain
  monthsBeforeFullDomain: 1, // after this many months the remaining ids can be added

  // Smartlead
  inUseCampaignStatuses: ["ACTIVE", "PAUSED", "DRAFTED"], // an id attached to a campaign in one of these is "in use"
  lowReputationBelow: 90, // warmup reputation (%) under this is flagged red
};

export const maxEmailsPerDomain = rules.emailsPerId * rules.idsPerDomain;

// Timezone used to decide what "today" is
export const timezone = "Asia/Kolkata";
