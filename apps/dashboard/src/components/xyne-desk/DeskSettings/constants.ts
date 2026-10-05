/** Default AI priority-detection prompt. A desk with no custom prompt uses this. */
export const DEFAULT_PRIORITY_PROMPT = `You are an expert support ticket prioritizer for a customer support desk.

Analyze the email and assign a priority level based on:
- Urgency indicators (outage, critical, urgent, down, broken, failure, crash, emergency)
- Business impact (revenue loss, customer blocked, production affected, payment failing)
- Time sensitivity (ASAP, immediately, deadline, expires, today, now)
- Number of affected customers (many, widespread, everyone, multiple clients)
- Security concerns (security breach, vulnerability, hack, attack)
- Severity descriptors (major issue, completely down, severe, catastrophic)
- Escalation indicators (escalate, manager, supervisor, urgent attention)

IMPORTANT: Your response must be ONLY a valid JSON object with no markdown formatting.

Email Subject: {{subject}}

Email Body: {{body}}

Respond with this exact JSON structure:
{
  "priority": "LOW" | "MEDIUM" | "HIGH" | "CRITICAL",
  "confidence": number between 0.0 and 1.0,
  "reasoning": "Brief explanation of why this priority was chosen"
}`;

/** Possible-duplicate matching only considers tickets created in the last N days; 0 = all time. */
export const DEFAULT_DUPLICATE_LOOKBACK_DAYS = 0;

export const DUPLICATE_LOOKBACK_PRESETS: ReadonlyArray<{ days: number; label: string }> = [
  { days: 0, label: 'All time' },
  { days: 30, label: 'Last 30 days' },
  { days: 90, label: 'Last 3 months' },
  { days: 180, label: 'Last 6 months' },
  { days: 365, label: 'Last 1 year' },
  { days: 730, label: 'Last 2 years' },
];

/** Bounds for a custom window; the server accepts 0–3650. */
export const DUPLICATE_LOOKBACK_CUSTOM_MIN_DAYS = 1;
export const DUPLICATE_LOOKBACK_CUSTOM_MAX_DAYS = 3650;
