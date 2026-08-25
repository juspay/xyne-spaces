/**
 * Feature taxonomy for product-adoption analytics.
 *
 * The app already emits a large, inconsistently-named stream of engagement
 * signals: frontend `data-track-category` / `data-track-name` clicks and
 * backend useractivity `eventCategory` / `eventName` records. This module
 * normalizes those source labels into a small, stable set of product
 * "features" so SudoQuery / ClickHouse can answer questions like
 * "how many unique users clicked on <feature>" with a single swappable key.
 *
 * Known sources map to a canonical feature; unknown categories fall back to a
 * slug of the category so no engagement is silently dropped ("Everything").
 */

// Canonical feature keyed by a resolved module path (see moduleRoutes.ts).
// Used for the time-spent signal, which is keyed off page/module dwell.
const FEATURE_BY_MODULE: Record<string, string> = {
  '/chat/dir/threads': 'thread',
  '/chat/dir/unreads': 'thread',
  '/chat/dir/recap': 'thread',
  '/chat/dm': 'dm',
  '/chat/activity': 'activity',
  '/chat/canvas': 'canvas',
  '/chat/dir/canvas': 'canvas',
  '/chat/dir/my-tickets': 'ticket',
  '/chat/bookmarks': 'bookmark',
  '/chat/drafts-sent': 'message',
  '/chat/search': 'search',
  '/search-results': 'search',
  '/recordings': 'recording',
  '/calls': 'call',
  '/knowledge-base': 'knowledge_base',
  '/ai/knowledge': 'knowledge_base',
  '/memory': 'memory',
  '/agents': 'agent',
  '/claw-agents': 'agent',
  '/ai/chat/new': 'agent',
  '/ai/library': 'agent',
  '/projects': 'project',
  '/listProjects': 'project',
  '/forms': 'form',
  '/automations': 'automation',
  '/analytics': 'dashboard',
  '/analytics-dashboard': 'dashboard',
  '/dashboards': 'dashboard',
  '/product-insights': 'dashboard',
  '/rca': 'rca',
  '/support/all': 'support',
  '/daily-brief': 'daily_brief',
};

// Canonical feature keyed by a normalized source category (data-track-category
// or useractivity eventCategory). Matched case/separator-insensitively via
// normalizeKey, so 'CALLS', 'Calls' and 'calls' all collapse to the same key.
const FEATURE_BY_CATEGORY: Record<string, string> = {
  calls: 'call',
  call: 'call',
  chat: 'message',
  chatsidebar: 'message',
  message: 'message',
  messagesent: 'message',
  tickets: 'ticket',
  ticket: 'ticket',
  ticketfilters: 'ticket',
  canvas: 'canvas',
  channel: 'channel',
  activity: 'activity',
  recordingdetailv2: 'recording',
  recordingsscreen: 'recording',
  recordings: 'recording',
  knowledgebase: 'knowledge_base',
  xyneai: 'agent',
  askai: 'agent',
  clawchat: 'agent',
  clawagents: 'agent',
  searchresults: 'search',
  querybuilder: 'search',
  automationbuilder: 'automation',
  automationruns: 'automation',
  usergroups: 'user_group',
  preferences: 'settings',
};

function normalizeKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

/** Resolve a whitelisted module path to a canonical feature, or null. */
export function resolveFeatureFromModule(module: string): string | null {
  return FEATURE_BY_MODULE[module] ?? null;
}

/**
 * Resolve a click/engagement event to a canonical feature. Falls back to a
 * slug of the source category so unmapped surfaces are still counted rather
 * than dropped. Returns null only when there is no usable category at all.
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
