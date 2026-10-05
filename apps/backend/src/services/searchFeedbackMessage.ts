import { escapeHtml } from '@/utils/htmlEscape';

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
  /** Group mention HTML, or null if the group wasn't found. */
  groupMentionHtml: string | null;
  /** Reporter mention HTML, or null if the user wasn't found. */
  reporterMentionHtml: string | null;
  /** Plain reporter name, used when there's no mention HTML. */
  reporterName: string;
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
 * Builds the HTML message posted to the feedback channel.
 *
 * All user input is escaped. The mention HTML is inserted as-is: it's built by the caller,
 * and the notification code needs the exact markup to detect the mentions.
 */
export function buildSearchFeedbackContent(params: SearchFeedbackContentParams): string {
  const {
    groupMentionHtml,
    reporterMentionHtml,
    reporterName,
    query,
    feedback,
    filters,
    sort,
    source,
    workspaceName,
    when,
    timeZone,
  } = params;

  const reporter = reporterMentionHtml ?? `@${escapeHtml(reporterName)}`;
  const headline = `New search feedback from ${reporter}`;
  const lines: string[] = [];

  lines.push(groupMentionHtml ? `${groupMentionHtml} ${headline}` : headline);
  lines.push('');
  // The comment is optional; without one the message goes straight to the details.
  if (feedback.trim()) {
    lines.push(`<em>"${escapeHtml(feedback)}"</em>`);
    lines.push('');
  }
  lines.push(
    query.trim()
      ? `<strong>Query:</strong> ${escapeHtml(query)}`
      : '<strong>Query:</strong> <em>(empty)</em>'
  );

  const appliedFilters = filters.map((f) => f.trim()).filter(Boolean);
  lines.push(
    `<strong>Filters:</strong> ${
      appliedFilters.length > 0 ? appliedFilters.map(escapeHtml).join(FILTER_SEPARATOR) : NO_FILTERS
    }`
  );

  if (sort?.trim()) {
    lines.push(`<strong>Sort:</strong> ${escapeHtml(sort.trim())}`);
  }

  lines.push(`<strong>Surface:</strong> ${escapeHtml(SOURCE_LABELS[source])}`);
  lines.push(
    `<strong>Workspace:</strong> ${
      workspaceName.trim() ? escapeHtml(workspaceName.trim()) : '<em>(unknown)</em>'
    }`
  );
  lines.push(`<strong>When:</strong> ${escapeHtml(formatFeedbackTimestamp(when, timeZone))}`);

  return lines.join('<br/>');
}
