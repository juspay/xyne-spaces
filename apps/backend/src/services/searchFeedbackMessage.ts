/** Where the feedback was sent from. A fixed set, so the message never echoes client text here. */
export type SearchFeedbackSource = 'cmdk' | 'search_results';

const SOURCE_LABELS: Record<SearchFeedbackSource, string> = {
  cmdk: 'Cmd K modal',
  search_results: 'Full-page search',
};

export const SEARCH_FEEDBACK_SOURCES = Object.keys(SOURCE_LABELS) as SearchFeedbackSource[];

/** Separator between filter labels in the message. */
const FILTER_SEPARATOR = ' · ';

/** Shown when no filters were applied. */
const NO_FILTERS = 'None';

export interface SearchFeedbackContentParams {
  /** Xyne user group to tag, or null to post without a tag. */
  userGroupId: string | null;
  /**
   * Reporter to mention, or null to name them in plain text. Only set when the reporter is in the
   * channel's workspace: the webhook resolves `<@id>` there, so anyone else would show as unknown.
   */
  reporterMentionId: string | null;
  reporterName: string;
  reporterEmail: string | null;
  query: string;
  feedback: string;
  /** Active filter labels as shown in the UI, e.g. `@Ch`, `from:alice`, `"ab"`. */
  filters: string[];
  /** Sort label. Only the full-page search has one. */
  sort?: string;
  source: SearchFeedbackSource;
  /** Reporter's workspace. Needed because one channel can receive feedback from many workspaces. */
  workspaceName: string;
  when: Date;
  /** Timezone for the `When:` line, e.g. `Asia/Kolkata`. */
  timeZone: string;
}

/** Formats a date as `Sep 24, 2026 · 3:42 PM` in the given timezone. */
export function formatFeedbackTimestamp(when: Date, timeZone: string): string {
  const date = new Intl.DateTimeFormat('en-US', {
    timeZone,
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(when);
  const time = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(when);
  return `${date} · ${time}`;
}

/**
 * Slack's text escaping. The webhook passes raw `<…>` through as HTML and turns `<!subteam^…>` /
 * `<@…>` into mentions, so every user value goes through this: typed text can't add markup or
 * ping anyone.
 */
function escapeSlackText(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Builds the message sent to the incoming webhook, in Slack's text format (the webhook's format).
 * The webhook turns `<!subteam^id>` into a group mention, `*x*` into bold and `> x` into a quote.
 *
 * The reporter is mentioned only when they're in the channel's workspace (see
 * `reporterMentionId`); otherwise they're named in plain text with their email.
 */
export function buildSearchFeedbackText(params: SearchFeedbackContentParams): string {
  const {
    userGroupId,
    reporterMentionId,
    reporterName,
    reporterEmail,
    query,
    feedback,
    filters,
    sort,
    source,
    workspaceName,
    when,
    timeZone,
  } = params;

  const reporter = reporterMentionId
    ? `<@${reporterMentionId}>`
    : reporterEmail
      ? `*${escapeSlackText(reporterName)}* (${escapeSlackText(reporterEmail)})`
      : `*${escapeSlackText(reporterName)}*`;
  const headline = `New search feedback from ${reporter}`;
  const lines: string[] = [];

  lines.push(userGroupId ? `<!subteam^${userGroupId}> ${headline}` : headline);
  lines.push('');
  // The comment is optional; without one the message goes straight to the details.
  if (feedback.trim()) {
    for (const line of feedback.trim().split('\n')) {
      lines.push(`> ${escapeSlackText(line)}`);
    }
    lines.push('');
  }
  lines.push(`*Query:* ${query.trim() ? escapeSlackText(query.trim()) : '_(empty)_'}`);

  const appliedFilters = filters.map((f) => f.trim()).filter(Boolean);
  lines.push(
    `*Filters:* ${
      appliedFilters.length > 0
        ? appliedFilters.map(escapeSlackText).join(FILTER_SEPARATOR)
        : NO_FILTERS
    }`
  );

  if (sort?.trim()) {
    lines.push(`*Sort:* ${escapeSlackText(sort.trim())}`);
  }

  lines.push(`*Surface:* ${SOURCE_LABELS[source]}`);
  lines.push(
    `*Workspace:* ${workspaceName.trim() ? escapeSlackText(workspaceName.trim()) : '_(unknown)_'}`
  );
  lines.push(`*When:* ${formatFeedbackTimestamp(when, timeZone)}`);

  return lines.join('\n');
}
