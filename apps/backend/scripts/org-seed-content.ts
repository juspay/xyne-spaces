/**
 * Content for `org-seed.ts` — a 100-person payments company.
 *
 * Kept separate from the seeding logic so names, channels and dialogue can be
 * edited without touching Prisma code, the same split `demo-seed-content.ts`
 * uses.
 *
 * The company is modelled on a payments product org (Juspay-shaped): payment
 * rails, bank integrations, settlements and risk, plus the ordinary channels any
 * company of this size accumulates.
 */

export type Person = {
  first: string;
  last: string;
  title: string;
  team: string;
  /** Chooses which randomuser.me portrait set the avatar comes from. */
  g: 'm' | 'f';
};

export type ChannelSpec = {
  name: string;
  purpose: string;
  visibility: 'PUBLIC' | 'PRIVATE';
  /**
   * How many people are in it:
   *   squad — 4-9    a team that actually meets
   *   team  — 12-28  a function or a domain
   *   org   — 45-85  everyone who cares, which is most people
   */
  size: 'squad' | 'team' | 'org';
};

/** One message in the #xyne-spaces conversation. */
export type Reply = { from: number; text: string; react?: string };
export type Thread = { from: number; text: string; react?: string; replies: Reply[] };

// ---------------------------------------------------------------------------
// People
// ---------------------------------------------------------------------------

export const PEOPLE: Person[] = [
  { first: 'Ananya', last: 'Krishnan', title: 'Director of Engineering', team: 'Platform', g: 'f' },
  { first: 'Rahul', last: 'Deshpande', title: 'Principal Engineer', team: 'Payments Core', g: 'm' },
  { first: 'Meera', last: 'Subramanian', title: 'Staff Engineer', team: 'UPI', g: 'f' },
  { first: 'Vikram', last: 'Chandra', title: 'Engineering Manager', team: 'Checkout SDK', g: 'm' },
  { first: 'Sneha', last: 'Pillai', title: 'Senior Product Manager', team: 'Payments Core', g: 'f' },
  { first: 'Karthik', last: 'Nair', title: 'Backend Engineer', team: 'Payments Core', g: 'm' },
  { first: 'Divya', last: 'Ramesh', title: 'Backend Engineer', team: 'UPI', g: 'f' },
  { first: 'Aditya', last: 'Bhat', title: 'SRE Lead', team: 'SRE', g: 'm' },
  { first: 'Nikhil', last: 'Joshi', title: 'Site Reliability Engineer', team: 'SRE', g: 'm' },
  { first: 'Pooja', last: 'Agarwal', title: 'Product Designer', team: 'Design', g: 'f' },
  { first: 'Rohan', last: 'Mehta', title: 'Head of Design', team: 'Design', g: 'm' },
  { first: 'Lakshmi', last: 'Venkatesh', title: 'Engineering Manager', team: 'Settlements', g: 'f' },
  { first: 'Arun', last: 'Prakash', title: 'Senior Backend Engineer', team: 'Settlements', g: 'm' },
  { first: 'Shreya', last: 'Kulkarni', title: 'Data Scientist', team: 'Risk & Fraud', g: 'f' },
  { first: 'Manish', last: 'Tiwari', title: 'Staff Engineer', team: 'Risk & Fraud', g: 'm' },
  { first: 'Neha', last: 'Bansal', title: 'Product Manager', team: 'Checkout SDK', g: 'f' },
  { first: 'Sanjay', last: 'Iyengar', title: 'VP Engineering', team: 'Platform', g: 'm' },
  { first: 'Ritika', last: 'Sharma', title: 'Frontend Engineer', team: 'Checkout SDK', g: 'f' },
  { first: 'Vivek', last: 'Anand', title: 'Android Engineer', team: 'Checkout SDK', g: 'm' },
  { first: 'Kavya', last: 'Reddy', title: 'iOS Engineer', team: 'Checkout SDK', g: 'f' },
  { first: 'Suresh', last: 'Babu', title: 'Database Engineer', team: 'Platform', g: 'm' },
  { first: 'Anjali', last: 'Mishra', title: 'Security Engineer', team: 'Security', g: 'f' },
  { first: 'Harish', last: 'Gowda', title: 'Head of Security', team: 'Security', g: 'm' },
  { first: 'Priyanka', last: 'Dutta', title: 'QA Lead', team: 'QA', g: 'f' },
  { first: 'Amit', last: 'Saxena', title: 'QA Automation Engineer', team: 'QA', g: 'm' },
  { first: 'Deepa', last: 'Narayanan', title: 'Support Manager', team: 'Support', g: 'f' },
  { first: 'Gaurav', last: 'Malhotra', title: 'Merchant Support Lead', team: 'Support', g: 'm' },
  { first: 'Swati', last: 'Kapoor', title: 'Technical Account Manager', team: 'Customer Success', g: 'f' },
  { first: 'Rajesh', last: 'Kumar', title: 'Integration Engineer', team: 'Merchant Onboarding', g: 'm' },
  { first: 'Ishita', last: 'Chatterjee', title: 'Product Manager', team: 'Risk & Fraud', g: 'f' },
  { first: 'Varun', last: 'Sethi', title: 'Backend Engineer', team: 'UPI', g: 'm' },
  { first: 'Nandini', last: 'Rao', title: 'Backend Engineer', team: 'Settlements', g: 'f' },
  { first: 'Siddharth', last: 'Menon', title: 'Staff Engineer', team: 'Platform', g: 'm' },
  { first: 'Tanvi', last: 'Shah', title: 'Data Engineer', team: 'Data', g: 'f' },
  { first: 'Prashant', last: 'Rane', title: 'Analytics Lead', team: 'Data', g: 'm' },
  { first: 'Aarti', last: 'Vaidya', title: 'Finance Controller', team: 'Finance', g: 'f' },
  { first: 'Mohit', last: 'Aggarwal', title: 'Finance Analyst', team: 'Finance', g: 'm' },
  { first: 'Reena', last: 'Thomas', title: 'Compliance Officer', team: 'Compliance', g: 'f' },
  { first: 'Abhishek', last: 'Sinha', title: 'Legal Counsel', team: 'Legal', g: 'm' },
  { first: 'Sunita', last: 'Rajan', title: 'Head of People', team: 'People', g: 'f' },
  { first: 'Kunal', last: 'Bajaj', title: 'Talent Partner', team: 'People', g: 'm' },
  { first: 'Megha', last: 'Trivedi', title: 'Marketing Manager', team: 'Marketing', g: 'f' },
  { first: 'Nitin', last: 'Chopra', title: 'Enterprise Sales', team: 'Sales', g: 'm' },
  { first: 'Sana', last: 'Qureshi', title: 'Partnerships Lead', team: 'Sales', g: 'f' },
  { first: 'Devansh', last: 'Patel', title: 'Backend Engineer', team: 'Payments Core', g: 'm' },
  { first: 'Ayesha', last: 'Khan', title: 'Frontend Engineer', team: 'Platform', g: 'f' },
  { first: 'Rakesh', last: 'Verma', title: 'Engineering Manager', team: 'Risk & Fraud', g: 'm' },
  { first: 'Bhavna', last: 'Sood', title: 'Product Designer', team: 'Design', g: 'f' },
  { first: 'Yash', last: 'Bhardwaj', title: 'Design Systems Engineer', team: 'Design', g: 'm' },
  { first: 'Ritu', last: 'Malviya', title: 'Technical Writer', team: 'Product', g: 'f' },
  { first: 'Ganesh', last: 'Moorthy', title: 'Platform Engineer', team: 'Platform', g: 'm' },
  { first: 'Sarita', last: 'Jain', title: 'Site Reliability Engineer', team: 'SRE', g: 'f' },
  { first: 'Imran', last: 'Sheikh', title: 'Network Engineer', team: 'Platform', g: 'm' },
  { first: 'Kritika', last: 'Sen', title: 'Backend Engineer', team: 'Risk & Fraud', g: 'f' },
  { first: 'Vinod', last: 'Pandey', title: 'Integration Engineer', team: 'Merchant Onboarding', g: 'm' },
  { first: 'Shalini', last: 'Hegde', title: 'Engineering Manager', team: 'UPI', g: 'f' },
  { first: 'Pranav', last: 'Kaul', title: 'Backend Engineer', team: 'Checkout SDK', g: 'm' },
  { first: 'Aditi', last: 'Ghosh', title: 'Product Manager', team: 'Settlements', g: 'f' },
  { first: 'Sameer', last: 'Wagle', title: 'Staff Engineer', team: 'Payments Core', g: 'm' },
  { first: 'Preeti', last: 'Salunke', title: 'QA Engineer', team: 'QA', g: 'f' },
  { first: 'Dhruv', last: 'Oberoi', title: 'Backend Engineer', team: 'Platform', g: 'm' },
  { first: 'Namrata', last: 'Bose', title: 'Data Analyst', team: 'Data', g: 'f' },
  { first: 'Ravi', last: 'Shankar', title: 'Principal Architect', team: 'Platform', g: 'm' },
  { first: 'Juhi', last: 'Mathur', title: 'Support Engineer', team: 'Support', g: 'f' },
  { first: 'Tarun', last: 'Grover', title: 'Support Engineer', team: 'Support', g: 'm' },
  { first: 'Anushka', last: 'Deo', title: 'Product Manager', team: 'UPI', g: 'f' },
  { first: 'Faisal', last: 'Ahmed', title: 'Backend Engineer', team: 'Settlements', g: 'm' },
  { first: 'Rashmi', last: 'Nayak', title: 'Engineering Manager', team: 'Data', g: 'f' },
  { first: 'Akash', last: 'Dubey', title: 'DevOps Engineer', team: 'SRE', g: 'm' },
  { first: 'Sonal', last: 'Gupta', title: 'Product Designer', team: 'Design', g: 'f' },
  { first: 'Naveen', last: 'Rajagopal', title: 'Backend Engineer', team: 'UPI', g: 'm' },
  { first: 'Trisha', last: 'Fernandes', title: 'Customer Success Manager', team: 'Customer Success', g: 'f' },
  { first: 'Manoj', last: 'Pillai', title: 'Solutions Architect', team: 'Merchant Onboarding', g: 'm' },
  { first: 'Vandana', last: 'Rathi', title: 'Risk Analyst', team: 'Risk & Fraud', g: 'f' },
  { first: 'Zubin', last: 'Mistry', title: 'Staff Engineer', team: 'Security', g: 'm' },
  { first: 'Aparna', last: 'Balaji', title: 'Backend Engineer', team: 'Payments Core', g: 'f' },
  { first: 'Hemant', last: 'Kulshrestha', title: 'Engineering Manager', team: 'Platform', g: 'm' },
  { first: 'Nisha', last: 'Chauhan', title: 'Frontend Engineer', team: 'Checkout SDK', g: 'f' },
  { first: 'Sachin', last: 'Waghmare', title: 'Android Engineer', team: 'Checkout SDK', g: 'm' },
  { first: 'Ekta', last: 'Bhagat', title: 'QA Engineer', team: 'QA', g: 'f' },
  { first: 'Rohit', last: 'Chakraborty', title: 'Backend Engineer', team: 'Risk & Fraud', g: 'm' },
  { first: 'Madhavi', last: 'Rao', title: 'Product Manager', team: 'Product', g: 'f' },
  { first: 'Ashwin', last: 'Kamath', title: 'Backend Engineer', team: 'UPI', g: 'm' },
  { first: 'Sneha', last: 'Bhatt', title: 'Data Engineer', team: 'Data', g: 'f' },
  { first: 'Vishal', last: 'Rawat', title: 'Site Reliability Engineer', team: 'SRE', g: 'm' },
  { first: 'Farah', last: 'Siddiqui', title: 'Security Analyst', team: 'Security', g: 'f' },
  { first: 'Ajay', last: 'Bhosale', title: 'Integration Engineer', team: 'Merchant Onboarding', g: 'm' },
  { first: 'Charu', last: 'Awasthi', title: 'Technical Writer', team: 'Product', g: 'f' },
  { first: 'Sumit', last: 'Raina', title: 'Backend Engineer', team: 'Settlements', g: 'm' },
  { first: 'Leela', last: 'Prasad', title: 'Finance Analyst', team: 'Finance', g: 'f' },
  { first: 'Prateek', last: 'Jha', title: 'Backend Engineer', team: 'Platform', g: 'm' },
  { first: 'Anita', last: 'Desai', title: 'Recruiter', team: 'People', g: 'f' },
  { first: 'Kiran', last: 'Bhalerao', title: 'Office Manager', team: 'People', g: 'f' },
  { first: 'Sandeep', last: 'Yadav', title: 'Enterprise Sales', team: 'Sales', g: 'm' },
  { first: 'Ruchi', last: 'Tandon', title: 'Marketing Associate', team: 'Marketing', g: 'f' },
  { first: 'Nilesh', last: 'Kadam', title: 'QA Automation Engineer', team: 'QA', g: 'm' },
  { first: 'Payal', last: 'Chhabra', title: 'Product Designer', team: 'Design', g: 'f' },
  { first: 'Anand', last: 'Seshadri', title: 'Staff Engineer', team: 'Payments Core', g: 'm' },
  { first: 'Geetha', last: 'Murali', title: 'Compliance Analyst', team: 'Compliance', g: 'f' },
  { first: 'Yogesh', last: 'Pawar', title: 'Platform Engineer', team: 'Platform', g: 'm' },
];

// ---------------------------------------------------------------------------
// Channels
// ---------------------------------------------------------------------------

/**
 * 100 channels; #xyne-spaces is created separately by the seeder because every
 * person is in it and it is the only one carrying a conversation.
 *
 * All of these are ordinary channels (ChannelType.DEFAULT / scope DEFAULT) and
 * vary only by visibility. The other ChannelType members — EMAIL, SUPPORT,
 * SLACK, APP, CALL — change how the channel renders and what backing rows it
 * expects (an external source, a mailbox, a call), so seeding them as plain
 * channels would produce broken-looking rows rather than variety.
 */
export const CHANNELS: ChannelSpec[] = [
  // Company-wide
  { name: 'general', purpose: 'Company-wide chatter. Anything that does not have a better home.', visibility: 'PUBLIC', size: 'org' },
  { name: 'announcements', purpose: 'Company announcements. Low volume, everyone reads it.', visibility: 'PUBLIC', size: 'org' },
  { name: 'random', purpose: 'Links, memes, and the occasional genuinely useful thing.', visibility: 'PUBLIC', size: 'org' },
  { name: 'all-hands', purpose: 'Agenda, slides and questions for the monthly all-hands.', visibility: 'PUBLIC', size: 'org' },
  { name: 'new-joiners', purpose: 'Introductions, first-week questions, and who to ask about what.', visibility: 'PUBLIC', size: 'org' },
  { name: 'celebrations', purpose: 'Shipped something? Someone did you a favour? Say so here.', visibility: 'PUBLIC', size: 'org' },
  { name: 'tech-talks', purpose: 'Friday sessions — topics, recordings, and volunteers.', visibility: 'PUBLIC', size: 'team' },
  { name: 'bangalore-hq', purpose: 'Office logistics — desks, parking, cafeteria, visitor passes.', visibility: 'PUBLIC', size: 'org' },
  { name: 'it-helpdesk', purpose: 'Laptops, access requests, MDM, the printer.', visibility: 'PUBLIC', size: 'org' },

  // Engineering craft
  { name: 'engineering', purpose: 'Cross-team engineering discussion and decisions worth broadcasting.', visibility: 'PUBLIC', size: 'org' },
  { name: 'backend-guild', purpose: 'Service patterns, libraries, and arguments about naming.', visibility: 'PUBLIC', size: 'team' },
  { name: 'frontend-guild', purpose: 'Web platform, bundling, rendering, and browser bugs.', visibility: 'PUBLIC', size: 'team' },
  { name: 'mobile-guild', purpose: 'Android and iOS — SDK size, crash rates, store releases.', visibility: 'PUBLIC', size: 'team' },
  { name: 'architecture-review', purpose: 'RFCs before they are built. Post the doc, get the pushback early.', visibility: 'PUBLIC', size: 'team' },
  { name: 'code-review-help', purpose: 'Stuck PRs looking for a reviewer who knows the area.', visibility: 'PUBLIC', size: 'team' },
  { name: 'tech-debt', purpose: 'Things we know are wrong and have not fixed yet.', visibility: 'PUBLIC', size: 'team' },
  { name: 'dependency-upgrades', purpose: 'Version bumps, CVE patches, and what they broke.', visibility: 'PUBLIC', size: 'team' },
  { name: 'build-failures', purpose: 'Red builds on main. Automated noise plus whoever is fixing it.', visibility: 'PUBLIC', size: 'team' },
  { name: 'ci-cd', purpose: 'Pipelines, runners, flaky stages, deploy tooling.', visibility: 'PUBLIC', size: 'team' },
  { name: 'api-changelog', purpose: 'Every merchant-facing API change, before it ships.', visibility: 'PUBLIC', size: 'team' },
  { name: 'docs', purpose: 'Developer docs — gaps, corrections, and rewrites in flight.', visibility: 'PUBLIC', size: 'team' },
  { name: 'design-system', purpose: 'Components, tokens, and keeping the checkout UI consistent.', visibility: 'PUBLIC', size: 'team' },
  { name: 'observability', purpose: 'Traces, dashboards, and what we still cannot see.', visibility: 'PUBLIC', size: 'team' },
  { name: 'grafana-alerts', purpose: 'Alert routing and tuning. Where noisy alerts come to die.', visibility: 'PUBLIC', size: 'team' },
  { name: 'kafka-pipelines', purpose: 'Topics, consumer lag, retention, and replay runbooks.', visibility: 'PUBLIC', size: 'squad' },
  { name: 'postgres-ops', purpose: 'Slow queries, vacuum, replicas, and schema migrations.', visibility: 'PUBLIC', size: 'squad' },
  { name: 'kubernetes-platform', purpose: 'Clusters, autoscaling, node pools, and noisy neighbours.', visibility: 'PUBLIC', size: 'team' },
  { name: 'load-testing', purpose: 'Peak-load rehearsals ahead of sale events.', visibility: 'PUBLIC', size: 'squad' },
  { name: 'chaos-drills', purpose: 'Planned failure injection and what we learned.', visibility: 'PUBLIC', size: 'squad' },
  { name: 'feature-flags', purpose: 'Rollout plans, kill switches, and flags nobody cleaned up.', visibility: 'PUBLIC', size: 'team' },
  { name: 'cost-optimisation', purpose: 'Cloud spend by service and what we can turn off.', visibility: 'PUBLIC', size: 'squad' },

  // Payments domain
  { name: 'payments-core', purpose: 'The transaction engine — auth, capture, void, the state machine.', visibility: 'PUBLIC', size: 'team' },
  { name: 'upi-stack', purpose: 'UPI collect and intent flows, PSP behaviour, NPCI circulars.', visibility: 'PUBLIC', size: 'team' },
  { name: 'upi-autopay', purpose: 'Mandates, recurring debits, and pre-debit notifications.', visibility: 'PUBLIC', size: 'squad' },
  { name: 'upi-lite', purpose: 'On-device balance, low-value flows, and adoption numbers.', visibility: 'PUBLIC', size: 'squad' },
  { name: 'cards-vault', purpose: 'Card storage, encryption, and vault access reviews.', visibility: 'PUBLIC', size: 'squad' },
  { name: 'tokenization', purpose: 'Network tokens, token lifecycle, and issuer coverage.', visibility: 'PUBLIC', size: 'team' },
  { name: 'cof-tokenization', purpose: 'Card-on-file token migration for saved-card merchants.', visibility: 'PUBLIC', size: 'squad' },
  { name: 'netbanking', purpose: 'Bank redirect flows and per-bank success rates.', visibility: 'PUBLIC', size: 'team' },
  { name: 'wallets', purpose: 'Wallet partners, balance checks, and linking flows.', visibility: 'PUBLIC', size: 'squad' },
  { name: 'emi-and-offers', purpose: 'No-cost EMI, issuer offers, and discount eligibility rules.', visibility: 'PUBLIC', size: 'team' },
  { name: 'bnpl', purpose: 'Buy-now-pay-later partners and underwriting callbacks.', visibility: 'PUBLIC', size: 'squad' },
  { name: 'international-payments', purpose: 'Cross-border acceptance, currencies, and compliance limits.', visibility: 'PUBLIC', size: 'team' },
  { name: 'forex-and-fx', purpose: 'FX rates, markup logic, and settlement currency handling.', visibility: 'PUBLIC', size: 'squad' },
  { name: 'settlements', purpose: 'Merchant settlement cycles, holds, and payout timing.', visibility: 'PUBLIC', size: 'team' },
  { name: 'reconciliation', purpose: 'Bank files, mismatches, and the daily recon run.', visibility: 'PUBLIC', size: 'team' },
  { name: 'refunds', purpose: 'Refund flows, partial refunds, and stuck refund escalations.', visibility: 'PUBLIC', size: 'team' },
  { name: 'chargebacks', purpose: 'Dispute intake, evidence packets, and representment deadlines.', visibility: 'PUBLIC', size: 'team' },
  { name: 'payouts', purpose: 'Vendor payouts, IMPS/NEFT rails, and beneficiary validation.', visibility: 'PUBLIC', size: 'squad' },
  { name: 'subscriptions-billing', purpose: 'Recurring plans, dunning, and failed-renewal retries.', visibility: 'PUBLIC', size: 'team' },
  { name: 'payment-links', purpose: 'Hosted links and pages — expiry, branding, partial payments.', visibility: 'PUBLIC', size: 'squad' },
  { name: 'qr-payments', purpose: 'Static and dynamic QR, and reconciliation for offline merchants.', visibility: 'PUBLIC', size: 'squad' },
  { name: 'pos-integrations', purpose: 'In-store terminals, SoundBox, and device provisioning.', visibility: 'PUBLIC', size: 'squad' },
  { name: 'smart-router', purpose: 'Routing rules across acquirers and how we pick a PG.', visibility: 'PUBLIC', size: 'team' },
  { name: 'retry-engine', purpose: 'Retry ladders, backoff, and double-charge safety.', visibility: 'PUBLIC', size: 'squad' },
  { name: 'downtime-detection', purpose: 'Bank and PG health signals feeding the router.', visibility: 'PUBLIC', size: 'team' },
  { name: 'three-ds-auth', purpose: '3DS2 challenge flows, frictionless rates, and issuer quirks.', visibility: 'PUBLIC', size: 'team' },
  { name: 'otp-and-sms', purpose: 'OTP delivery, SMS vendors, and autoread on Android.', visibility: 'PUBLIC', size: 'squad' },
  { name: 'express-checkout', purpose: 'One-tap checkout, saved instruments, and conversion tests.', visibility: 'PUBLIC', size: 'team' },

  // Banks and networks
  { name: 'hdfc-integration', purpose: 'HDFC acquiring and netbanking — tickets, downtime, releases.', visibility: 'PUBLIC', size: 'squad' },
  { name: 'icici-integration', purpose: 'ICICI rails, certification, and UAT coordination.', visibility: 'PUBLIC', size: 'squad' },
  { name: 'axis-integration', purpose: 'Axis acquiring, settlement files, and contact escalations.', visibility: 'PUBLIC', size: 'squad' },
  { name: 'sbi-netbanking', purpose: 'SBI redirect flow, maintenance windows, and success rates.', visibility: 'PUBLIC', size: 'squad' },
  { name: 'npci-liaison', purpose: 'NPCI circulars, mandates, and switch behaviour changes.', visibility: 'PUBLIC', size: 'team' },
  { name: 'visa-mastercard', purpose: 'Scheme mandates, BIN updates, and certification cycles.', visibility: 'PUBLIC', size: 'team' },
  { name: 'rupay-rails', purpose: 'RuPay credit on UPI and scheme-specific handling.', visibility: 'PUBLIC', size: 'squad' },

  // Business and operations
  { name: 'support-escalations', purpose: 'Merchant issues that need engineering eyes today.', visibility: 'PUBLIC', size: 'team' },
  { name: 'customer-success', purpose: 'Account health, QBRs, and renewal risks.', visibility: 'PUBLIC', size: 'team' },
  { name: 'merchant-onboarding', purpose: 'New merchant integrations from kickoff to go-live.', visibility: 'PUBLIC', size: 'team' },
  { name: 'kyc-and-verification', purpose: 'Merchant KYC, document checks, and activation blockers.', visibility: 'PUBLIC', size: 'team' },
  { name: 'sales-updates', purpose: 'Pipeline movement and deals about to close.', visibility: 'PUBLIC', size: 'team' },
  { name: 'partnerships', purpose: 'Platform partners, aggregators, and co-marketing.', visibility: 'PUBLIC', size: 'squad' },
  { name: 'marketing', purpose: 'Campaigns, launch copy, and the developer blog.', visibility: 'PUBLIC', size: 'team' },
  { name: 'product', purpose: 'Product decisions, specs in review, and what we are not doing.', visibility: 'PUBLIC', size: 'team' },
  { name: 'design', purpose: 'Work in progress, critique requests, and research findings.', visibility: 'PUBLIC', size: 'team' },
  { name: 'data-science', purpose: 'Models for routing and risk, plus the eternal feature-store thread.', visibility: 'PUBLIC', size: 'team' },
  { name: 'analytics-requests', purpose: 'Ad-hoc data pulls. Ask here rather than DMing the data team.', visibility: 'PUBLIC', size: 'team' },
  { name: 'qa-automation', purpose: 'Regression suites, flaky tests, and pre-release sign-off.', visibility: 'PUBLIC', size: 'team' },
  { name: 'release-train', purpose: 'What ships this week, who is release captain, and cut times.', visibility: 'PUBLIC', size: 'team' },
  { name: 'incidents', purpose: 'Live incidents. Timeline in the thread, postmortem linked after.', visibility: 'PUBLIC', size: 'org' },
  { name: 'oncall-handover', purpose: 'Daily handover notes between on-call rotations.', visibility: 'PUBLIC', size: 'team' },

  // Private
  { name: 'leadership', purpose: 'Leadership team coordination.', visibility: 'PRIVATE', size: 'squad' },
  { name: 'eng-leads', purpose: 'Engineering managers — staffing, delivery risk, escalations.', visibility: 'PRIVATE', size: 'squad' },
  { name: 'roadmap-planning', purpose: 'Half-year planning before it is shared more widely.', visibility: 'PRIVATE', size: 'team' },
  { name: 'headcount-planning', purpose: 'Open roles, approvals, and team allocation.', visibility: 'PRIVATE', size: 'squad' },
  { name: 'comp-and-review', purpose: 'Performance cycle calibration and compensation.', visibility: 'PRIVATE', size: 'squad' },
  { name: 'hiring-decisions', purpose: 'Debriefs and offer decisions per candidate.', visibility: 'PRIVATE', size: 'team' },
  { name: 'interview-panel', purpose: 'Panel scheduling and interviewer calibration.', visibility: 'PRIVATE', size: 'team' },
  { name: 'sev1-war-room', purpose: 'Standing room for Sev1s. Muted until it is not.', visibility: 'PRIVATE', size: 'team' },
  { name: 'security-incidents', purpose: 'Suspected compromise handling. Need-to-know only.', visibility: 'PRIVATE', size: 'squad' },
  { name: 'pen-test-findings', purpose: 'External pentest reports and remediation tracking.', visibility: 'PRIVATE', size: 'squad' },
  { name: 'credentials-rotation', purpose: 'Key and certificate rotation schedules.', visibility: 'PRIVATE', size: 'squad' },
  { name: 'rbi-compliance', purpose: 'RBI guidelines, audit responses, and filing deadlines.', visibility: 'PRIVATE', size: 'team' },
  { name: 'pci-dss-audit', purpose: 'PCI scope, evidence collection, and QSA questions.', visibility: 'PRIVATE', size: 'squad' },
  { name: 'legal-and-compliance', purpose: 'Contracts, notices, and regulatory correspondence.', visibility: 'PRIVATE', size: 'squad' },
  { name: 'key-accounts', purpose: 'Top merchants — commercials, risks, and exec relationships.', visibility: 'PRIVATE', size: 'team' },
  { name: 'merchant-pricing', purpose: 'Rate cards, discounts, and margin approvals.', visibility: 'PRIVATE', size: 'squad' },
  { name: 'board-updates', purpose: 'Board deck drafts and metrics for the quarter.', visibility: 'PRIVATE', size: 'squad' },
  { name: 'finance-queries', purpose: 'Invoices, reimbursements, and vendor payments.', visibility: 'PRIVATE', size: 'team' },
  { name: 'vendor-management', purpose: 'Vendor evaluations, renewals, and contract owners.', visibility: 'PRIVATE', size: 'squad' },
];

// ---------------------------------------------------------------------------
// #xyne-spaces — the one channel with a conversation in it
// ---------------------------------------------------------------------------

/**
 * The company channel. Everyone is in it, so it reads like a real one: release
 * notes, an incident, a regulatory deadline, hiring, and the usual amount of
 * off-topic. Indices are into PEOPLE.
 *
 * Each Thread becomes one row in the channel feed; its replies are the thread.
 */
export const XYNE_SPACES: Thread[] = [
  {
    from: 16,
    text: "Morning all 👋 We've moved company-wide comms into Spaces from today. #announcements stays for the formal stuff — this channel is for everything the whole company should see as it happens.",
    react: '🎉',
    replies: [
      { from: 40, text: 'Finally. My inbox has been doing a job it was never good at.' },
      { from: 0, text: "One ask: keep the top level for things worth 100 people's attention, and take the back-and-forth into a thread. That's the only rule that matters.", react: '👍' },
      { from: 63, text: 'Is the old group still monitored, or do we cut over completely?' },
      { from: 16, text: 'Read-only from Friday. Anything unanswered there, repost here.', react: '🙏' },
    ],
  },
  {
    from: 11,
    text: 'Settlement cycle for the long weekend: banks are closed Saturday and Monday, so T+1 merchants settle Tuesday. Support, please get ahead of the tickets — the same three merchants ask every year.',
    replies: [
      { from: 25, text: 'Already drafted the note. Going out to the top 200 merchants this evening.' },
      { from: 26, text: 'Can we get the cutoff table on the status page too? Half the tickets are people checking whether we are down.', react: '💯' },
      { from: 11, text: 'Good idea. Sending it to you now.' },
      { from: 57, text: 'Adding it to the merchant dashboard banner as well so it is visible where they actually look.' },
    ],
  },
  {
    from: 7,
    text: '🚨 Elevated failures on HDFC netbanking since 14:20. Success rate down to 61% from 94%. Router is already shifting traffic away. Timeline in this thread.',
    react: '👀',
    replies: [
      { from: 7, text: '14:26 — confirmed on their side, they have an ongoing maintenance that overran. No ETA yet.' },
      { from: 8, text: '14:31 — routing weight for HDFC NB dropped to 5%. Overall success rate back to 91.4%.' },
      { from: 68, text: '14:40 — retry queue drained, no stuck transactions. Watching the double-charge guard, nothing so far.' },
      { from: 7, text: '15:12 — HDFC confirms recovery. Ramping back in 20% steps.', react: '🙌' },
      { from: 7, text: '15:58 — fully restored, success rate 94.2%. Postmortem tomorrow, I will link it here. No merchant-visible loss beyond the 38 minutes of degraded routing.' },
      { from: 68, text: 'Might be worth a quick huddle before the postmortem doc goes out — easier to walk the timeline live than have everyone reconstruct it from thread scrollback.', react: '👍' },
      { from: 16, text: 'Nicely handled. The automatic weight shift did what it was built to do.', react: '🔥' },
    ],
  },
  {
    from: 37,
    text: 'Reminder that the tokenization deadline for saved cards is end of next month. Merchants still on raw card storage will simply stop working — this is not a soft cutover.',
    replies: [
      { from: 4, text: 'How many merchants are still not migrated?' },
      { from: 37, text: '84 as of this morning, down from 310 in April. The long tail is small merchants with custom integrations.', react: '📉' },
      { from: 28, text: 'Onboarding is calling the top 20 by volume this week. The rest get the automated migration path.' },
      { from: 39, text: 'Please loop legal in before any deadline communication goes out externally.' },
    ],
  },
  {
    from: 3,
    text: 'Checkout SDK 4.2 is out 🚀 Bundle is 38% smaller, the UPI intent flow no longer flashes white on Android, and we finally killed the layout shift on slow networks.',
    react: '🚀',
    replies: [
      { from: 18, text: 'The bundle win is mostly dropping our own polyfills. We were shipping 2019 browser support to 2026 phones.' },
      { from: 79, text: 'Crash-free sessions up to 99.87% in the canary. Best we have had.', react: '📈' },
      { from: 15, text: 'Conversion on the canary cohort is up 1.2pp. Small sample, but it is the right direction.' },
      { from: 71, text: 'Two of my merchants asked specifically about the white flash. Telling them today.', react: '🎉' },
    ],
  },
  {
    from: 39,
    text: 'People ops: the new joiner cohort starts Monday — 11 people across engineering, support and design. Their first week is in #new-joiners, please say hello there rather than DMing them all at once.',
    replies: [
      { from: 91, text: 'Buddies are assigned. If you are one, you should already have a calendar invite for Monday 10:00.' },
      { from: 0, text: 'Engineering folks: they will be in your channels from day one. Do not let them sit reading code for a week — give them something small that ships.', react: '💯' },
    ],
  },
  {
    from: 13,
    text: 'The risk model retrain is done. Fraud catch rate is up 4.1pp at the same false-positive rate, which is worth roughly ₹2.3Cr a quarter in prevented chargebacks.',
    react: '🔥',
    replies: [
      { from: 46, text: 'Shipping behind a flag at 10% tomorrow, full rollout next week if the decline-rate metrics hold.' },
      { from: 29, text: 'Support should know: some legitimate high-value first-time buyers may see a step-up challenge that they did not before.' },
      { from: 25, text: 'Noted. We will watch the "why was I declined" tickets and report back.' },
      { from: 33, text: 'Feature store made this retrain a two-day job instead of two weeks. Worth saying out loud.', react: '🙌' },
    ],
  },
  {
    from: 22,
    text: 'Security: rotating the acquirer API credentials this Thursday 02:00-03:00 IST. No downtime expected, but if you own a service that caches those, check that it re-reads from the secret store rather than at boot.',
    replies: [
      { from: 61, text: 'Payments core re-reads on a 5-minute TTL. We are fine.' },
      { from: 50, text: 'The recon job reads at boot. Fixing it today so it does not need a restart.', react: '👍' },
      { from: 22, text: 'That is exactly the kind of thing this message was for, thank you.' },
    ],
  },
  {
    from: 34,
    text: 'Month-end recon closed clean — zero unmatched entries above ₹100 for the first time. Two years ago this took four people until midnight.',
    react: '🎉',
    replies: [
      { from: 12, text: 'The auto-match rules for partial refunds did most of it. Those were the bulk of the mismatches.' },
      { from: 35, text: 'Finance signs off without chasing anyone. Genuinely a different month-end.', react: '🙏' },
    ],
  },
  {
    from: 65,
    text: 'NPCI circular out this morning — new limits on autopay mandates for the low-value category, effective in six weeks. Reading it now, will summarise the engineering impact here.',
    replies: [
      { from: 65, text: 'Summary: mandate creation for under ₹15,000 no longer needs an AFA step. Execution notification timing stays the same. Net: a simpler flow for the majority of our mandates.', react: '👀' },
      { from: 55, text: 'That removes the biggest drop-off in the autopay funnel. Worth prioritising.' },
      { from: 4, text: 'Adding it to next sprint. Six weeks is comfortable if we start now and uncomfortable if we start in three.' },
      { from: 37, text: 'Compliance will want to review the copy on the mandate screen before it ships.' },
    ],
  },
  {
    from: 10,
    text: 'Design: the new checkout is going into user testing next week — 12 sessions, mix of first-time and repeat buyers. If you want to observe, the sessions are on the shared calendar.',
    replies: [
      { from: 47, text: 'Watching people use it is the fastest way to stop arguing about it internally.', react: '💯' },
      { from: 15, text: 'Especially the saved-instrument screen. We have three opinions and no evidence.' },
      { from: 10, text: 'That screen is the first thing in the script.' },
    ],
  },
  {
    from: 15,
    text: 'The saved-instrument screen debate has been going back and forth in text for two days — can we just get on a zoom for 15 minutes tomorrow morning and settle it?',
    replies: [
      { from: 9, text: "Yes please, I'll send the invite. Much easier to walk through the three options live than keep describing them in words." },
      { from: 17, text: 'Works for me. Quick sync at 10, anyone else with an opinion just drop in.' },
    ],
  },
  {
    from: 8,
    text: 'On-call handover note: quiet night. One page at 03:40 for consumer lag on the settlement topic, self-resolved in 6 minutes after the rebalance. No action needed, but I have raised the alert threshold slightly — that one pages more than it should.',
    replies: [
      { from: 51, text: 'Thanks. That alert has woken three of us this month for nothing.', react: '😅' },
      { from: 84, text: 'If it fires twice more this week let us just delete it and rely on the lag dashboard.' },
      { from: 84, text: "Who's on call this week if it does fire again? Want to make sure they see this thread before the page does." },
      { from: 8, text: "Sarita's up next, then me after. If it pages twice more, paging the on-call engineer directly is fine — do not wait on the auto-escalation to catch up." },
    ],
  },
  {
    from: 61,
    text: 'Data question for the room: does anyone actually use the weekly merchant CSV export? It costs a surprising amount to generate and I cannot find a single opener in the last 60 days.',
    replies: [
      { from: 35, text: 'Finance stopped using it when the dashboard landed.' },
      { from: 27, text: 'Two enterprise merchants pull it via the API. Not the emailed one though.' },
      { from: 61, text: 'Then I will kill the email and keep the API. Saves about ₹40k a month in compute.', react: '🔥' },
      { from: 16, text: 'Good. More of this please — things we built and nobody asked us to keep.' },
    ],
  },
  {
    from: 43,
    text: 'Enterprise deal closed with one of the larger travel aggregators 🎉 Go-live target is six weeks, which means international cards, multi-currency and a hard traffic profile.',
    react: '🎉',
    replies: [
      { from: 44, text: 'Their peak is genuinely spiky — flight sales open at midnight and they do a month of volume in an hour.' },
      { from: 29, text: 'Load test slot booked for week three. I would rather find the ceiling ourselves.', react: '👍' },
      { from: 62, text: 'Solutions architecture kickoff is Thursday. Everyone who needs to be there has the invite.' },
    ],
  },
  {
    from: 23,
    text: 'QA: the regression suite is green on the release branch, but I want to flag that we skipped 14 tests for the 3DS challenge flow because the sandbox issuer was down all day yesterday.',
    replies: [
      { from: 59, text: 'Sandbox is back up as of an hour ago. Rerunning those 14 now.' },
      { from: 3, text: 'Holding the release cut until they pass. Not shipping a 3DS change on skipped 3DS tests.', react: '👍' },
      { from: 59, text: 'All 14 green. 🟢' },
      { from: 16, text: 'Good call holding the cut on that. Skipped security-relevant tests should never quietly pass.' },
      { from: 3, text: 'Cutting now.' },
    ],
  },
  {
    from: 0,
    text: 'A small thing that has made a big difference on my team: putting the decision in the thread where the argument happened, not in a doc nobody opens. Three months later you can still find why.',
    react: '💯',
    replies: [
      { from: 32, text: 'Search actually finds it too, which was never true of our old wiki.' },
      { from: 76, text: 'I have started ending threads with "decision:" and one line. Cheap habit, pays off later.', react: '🙌' },
      { from: 5, text: 'Stealing this.' },
    ],
  },
  {
    from: 30,
    text: 'UPI success rate crossed 96.1% this week, our highest ever. Most of the gain is the downtime detector pulling traffic off two PSPs before their failures showed up in our own metrics.',
    react: '📈',
    replies: [
      { from: 6, text: 'It reacts about 90 seconds faster than we did manually, and it does it at 3am.' },
      { from: 55, text: 'Worth writing up externally. Merchants care about exactly this number.' },
      { from: 41, text: 'Blog draft this week if engineering will review it for accuracy.', react: '✍️' },
      { from: 94, text: "For the blog, one clear call-to-action beats three — link straight to the status page, skip the generic 'learn more' button." },
    ],
  },
  {
    from: 21,
    text: 'PSA: please stop pasting merchant IDs together with card BINs in public channels. Neither is secret on its own; together they are enough to identify a customer. Use the vault reference instead.',
    replies: [
      { from: 74, text: 'Adding a lint rule to the support template so the field is not there to fill in.' },
      { from: 22, text: 'And if you have already posted one, edit it rather than deleting — deleting loses the thread context for everyone else.', react: '👍' },
    ],
  },
  {
    from: 92,
    text: 'Coffee machine on the third floor is fixed. That is the whole update. Carry on.',
    react: '😂',
    replies: [
      { from: 92, text: 'Productivity metrics expected to recover by Thursday.', react: '😄' },
      { from: 9, text: 'Genuinely the most impactful deploy of the week.' },
    ],
  },
  {
    from: 62,
    text: 'Architecture review this Friday is on the retry engine rewrite. The RFC is up — read it before, not during. Comments on the doc, decisions in the room.',
    replies: [
      { from: 1, text: 'The interesting question is whether retries live in the router or stay in core. Come with an opinion.' },
      { from: 58, text: 'I have a strong one and it is wrong half the time, so I will come with two.', react: '😄' },
      { from: 63, text: 'Recording it for the people in the other timezone?' },
      { from: 62, text: 'Yes, and the decision will be summarised in the thread afterwards either way.' },
      { from: 1, text: 'Small thing for the RFC doc: the function we call this after the retry ladder gives up is named finalizeAndForget(), which undersells what it actually does. Renaming before merge.' },
    ],
  },
  {
    from: 25,
    text: 'Support volume is down 22% month on month, and the biggest single drop is "where is my settlement" — which stopped being a ticket when the dashboard started showing the cycle clearly.',
    react: '📉',
    replies: [
      { from: 25, text: 'Turns out most support tickets are a missing screen, not a missing answer.', react: '💯' },
      { from: 57, text: 'Next one on that list is refund status. Same treatment, hopefully same result.' },
      { from: 26, text: "Anyone free to talk through the refund-status scope this week? I'd rather align live before writing the doc than guess at what support actually needs." },
    ],
  },
  {
    from: 98,
    text: 'Compliance: PCI evidence collection starts next week. If you own a service that touches card data you will get a request for access logs and a config export. Please do not sit on it — last year the delay was entirely internal.',
    replies: [
      { from: 20, text: 'Can we automate the config export this time? It is the same six commands per service.' },
      { from: 98, text: 'If you build it, I will use it.', react: '🙏' },
      { from: 20, text: 'Fine. Script by Wednesday.' },
    ],
  },
  {
    from: 2,
    text: 'We are deprecating the v1 payments API. Six months notice, and no merchant will be cut off without a direct conversation first — but new integrations stop being accepted on v1 from next month.',
    replies: [
      { from: 27, text: 'How many merchants are still on v1?' },
      { from: 2, text: '112, but only 9 of them are above ₹1Cr monthly. The rest are migration-by-email.' },
      { from: 71, text: 'The 9 are mine. I would rather do those calls myself than have them get a generic notice.', react: '👍' },
      { from: 49, text: 'Docs will carry a banner on every v1 page from tomorrow with the migration guide linked.' },
    ],
  },
  {
    from: 58,
    text: 'The Friday tech talk this week is on how the smart router actually picks an acquirer, including the parts we are not proud of. Open to everyone, not just engineering.',
    react: '👀',
    replies: [
      { from: 26, text: 'Support would love this. Half our escalations are "why did it go to that bank".' },
      { from: 58, text: 'Then I will spend more time on the failure cases and less on the maths.', react: '🙌' },
      { from: 42, text: 'Recording please — the Mumbai folks cannot make Friday evenings.' },
    ],
  },
  {
    from: 19,
    text: "iOS SDK 4.2 is in review with Apple. Nothing controversial in it, but their review times have been unpredictable lately so I would not promise merchants a date this week.",
    replies: [
      { from: 78, text: 'Android is already at 60% rollout, no crash spike.' },
      { from: 3, text: 'Holding the joint announcement until both are live. One release note, not two.', react: '👍' },
    ],
  },
  {
    from: 6,
    text: "Anyone recognize this — I called the /v2/refunds endpoint against staging twice just now and both times it 500'd with no trace id in the response.",
    replies: [
      { from: 60, text: 'Check the correlation-id header, staging logs moved to per-header sharding last week — search by that instead of timestamp.' },
      { from: 6, text: 'That was it. Null merchant config on a fresh staging seed, nothing wrong with the endpoint. Sorry for the noise.', react: '😅' },
    ],
  },
  {
    from: 67,
    text: 'Analytics request queue is at 3 days and I would like to get it back to 1. If your request is genuinely a dashboard filter rather than a new pull, tell me and I will show you where it already exists.',
    replies: [
      { from: 61, text: 'Guilty. Two of mine were filters.', react: '😅' },
      { from: 34, text: 'A short "how to slice this yourself" session would probably remove half the queue.' },
      { from: 67, text: 'Doing that next Tuesday. Anyone who asks me for a CSV before then is getting an invite.' },
    ],
  },
  {
    from: 20,
    text: "Postgres upgrade on the primary cluster is scheduled for Sunday 02:00. Read replicas stay up throughout, so reporting is unaffected. Writes pause for an estimated 90 seconds.",
    replies: [
      { from: 60, text: 'Payments core buffers writes for up to 5 minutes, so a 90 second pause is invisible to merchants.' },
      { from: 8, text: 'On-call will be awake regardless. Rollback plan is tested and takes 4 minutes.', react: '👍' },
      { from: 20, text: 'Done — 71 seconds of write pause, no errors surfaced. Back to normal.', react: '🎉' },
    ],
  },
  {
    from: 89,
    text: 'Reminder that expense claims for the quarter close on the 25th. After that they roll into next quarter and everyone emails me about it, which is the outcome we are trying to avoid.',
    replies: [
      { from: 36, text: 'The new flow takes about 90 seconds. Genuinely no excuse now.' },
      { from: 89, text: 'Filed mine while reading this message.', react: '😄' },
    ],
  },
  {
    from: 16,
    text: 'Quarter close: we processed ₹18,400 Cr, up 31% year on year, with our best-ever uptime. That is a lot of small careful decisions by a lot of people. Thank you — genuinely.',
    react: '🎉',
    replies: [
      { from: 0, text: 'The uptime number is the one I am proudest of. Growth is easier than not breaking.' },
      { from: 40, text: 'Team dinner next Friday, details in #bangalore-hq.', react: '🙌' },
      { from: 24, text: 'And a reminder that the number includes a quarter where we changed the tokenization stack under live traffic.' },
      { from: 11, text: 'Still not entirely sure how that went as smoothly as it did.', react: '😄' },
    ],
  },
];
