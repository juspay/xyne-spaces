/**
 * Feature taxonomy for product-adoption analytics.
 *
 * The app already emits a large, inconsistently-named stream of engagement
 * signals: frontend `data-track-category` / `data-track-name` clicks and
 * backend useractivity `eventCategory` / `eventName` records. This module
 * maps those source labels onto the product's own SECTION names (the same
 * names the UI/nav uses) so SudoQuery / ClickHouse can answer questions like
 * "how many unique users clicked on <threads>" with a single swappable key.
 *
 * Naming rule: a feature IS the route's own section name (1:1) — we do NOT
 * collapse distinct sections into broader buckets. So `unreads`, `recap` and
 * `threads` stay separate; `analytics` and `product-insights` are NOT folded
 * into a generic "dashboard". Unknown click categories fall back to a slug of
 * the category so no engagement is silently dropped ("Everything").
 */

// Canonical feature keyed by a resolved module path (see moduleRoutes.ts).
// Value = that section's own name. Used for the time-spent (dwell) signal.
const FEATURE_BY_MODULE: Record<string, string> = {
  // Chat directory tabs — each tab is its own section.
  '/chat/dir/threads': 'threads',
  '/chat/dir/unreads': 'unreads',
  '/chat/dir/recap': 'recap',
  '/chat/dir/canvas': 'canvas',
  '/chat/dir/my-tickets': 'my-tickets',
  // Chat surfaces.
  '/chat/dm': 'dm',
  '/chat/activity': 'activity',
  '/chat/canvas': 'canvas',
  '/chat/bookmarks': 'bookmarks',
  '/chat/drafts-sent': 'drafts-sent',
  '/chat/search': 'search',
  // Global search results page (the full-screen results view).
  '/search-results': 'search-results',
  // Calls & recordings.
  '/recordings': 'recordings',
  '/calls': 'calls',
  // Knowledge / memory.
  '/knowledge-base': 'knowledge-base',
  '/ai/knowledge': 'knowledge',
  '/memory': 'memory',
  // Agents / AI.
  '/agents': 'agents',
  '/claw-agents': 'claw-agents',
  '/ai/chat/new': 'agent-chat',
  '/ai/library': 'agent-hub',
  // Projects / forms / automations.
  '/projects': 'projects',
  '/listProjects': 'projects',
  '/forms': 'forms',
  '/automations': 'automations',
  // Analytics family — kept distinct, NOT bucketed into "dashboard".
  '/analytics': 'analytics',
  '/analytics-dashboard': 'analytics-dashboard',
  '/dashboards': 'dashboards',
  '/product-insights': 'product-insights',
  // Misc.
  '/rca': 'rca',
  '/support/all': 'support',
  '/daily-brief': 'daily-brief',
};

// Canonical feature keyed by a normalized click category (data-track-category
// or useractivity eventCategory). Matched case/separator-insensitively via
// normalizeKey, so 'Search Results', 'search-results' and 'searchResults' all
// collapse to the same section name.
const FEATURE_BY_CATEGORY: Record<string, string> = {
  calls: 'calls',
  call: 'calls',
  tickets: 'my-tickets',
  ticket: 'my-tickets',
  ticketfilters: 'my-tickets',
  canvas: 'canvas',
  channel: 'threads',
  activity: 'activity',
  recordingdetailv2: 'recordings',
  recordingsscreen: 'recordings',
  recordings: 'recordings',
  knowledgebase: 'knowledge-base',
  xyneai: 'agent-chat',
  askai: 'agent-chat',
  clawchat: 'agent-chat',
  clawagents: 'claw-agents',
  searchresults: 'search-results',
  querybuilder: 'search-results',
  automationbuilder: 'automations',
  automationruns: 'automations',
  usergroups: 'user-groups',
  preferences: 'settings',
};

function normalizeKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Resolve a whitelisted module path to its section name, or null. */
export function resolveFeatureFromModule(module: string): string | null {
  return FEATURE_BY_MODULE[module] ?? null;
}

/**
 * Resolve a click/engagement event to a section name. Falls back to a slug of
 * the source category so unmapped surfaces are still counted rather than
 * dropped. Returns null only when there is no usable category at all.
 */
export function resolveFeature(input: { category?: string; eventName?: string }): string | null {
  const category = input.category?.trim();
  if (!category) {
    return null;
  }

  const mapped = FEATURE_BY_CATEGORY[normalizeKey(category)];
  if (mapped) {
    return mapped;
  }

  const slug = slugify(category);
  return slug || null;
}
