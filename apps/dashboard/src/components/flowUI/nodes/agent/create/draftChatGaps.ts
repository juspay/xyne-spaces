/**
 * The test chat always runs the model, even on a blank canvas. When a request
 * needs something the draft can't use, the agent reports it with claw's
 * report_capability_gap tool, and each report becomes a row under its reply.
 */

/** The tool claw gives draft test runs. Mirrors xyne-claw/src/draft-capability-gap.ts. */
export const CAPABILITY_GAP_TOOL = 'report_capability_gap';

export type CapabilityGapStatus = 'not_added' | 'not_connected' | 'after_save' | 'test_blocked';

export interface CapabilityGap {
  capability: string;
  status: CapabilityGapStatus;
  /** What the request needs it for, starting with a verb ("list your open issues"). */
  need: string;
}

const STATUSES: readonly CapabilityGapStatus[] = [
  'not_added',
  'not_connected',
  'after_save',
  'test_blocked',
];

/**
 * A gap from one streamed tool invocation, or null when the frame is another
 * tool, still running, or malformed. Only finished calls count: claw validates
 * the arguments before the call completes.
 */
export function capabilityGapFromInvocation(invocation: unknown): CapabilityGap | null {
  if (!invocation || typeof invocation !== 'object') return null;
  const frame = invocation as Record<string, unknown>;
  if (frame['toolName'] !== CAPABILITY_GAP_TOOL) return null;
  if (frame['status'] !== 'completed' || frame['isError'] === true) return null;
  const args = frame['args'];
  if (!args || typeof args !== 'object') return null;
  const raw = args as Record<string, unknown>;
  const capability = typeof raw['capability'] === 'string' ? raw['capability'].trim() : '';
  const need = typeof raw['need'] === 'string' ? raw['need'].trim() : '';
  const status = raw['status'];
  if (!capability || !need || !STATUSES.includes(status as CapabilityGapStatus)) return null;
  return { capability, need, status: status as CapabilityGapStatus };
}

export function capabilityGapKey(gap: CapabilityGap): string {
  return `${gap.capability.toLowerCase()}:${gap.status}`;
}

/** Adds a gap unless the same capability was already reported with that status. */
export function withCapabilityGap(
  gaps: CapabilityGap[] | undefined,
  gap: CapabilityGap,
): CapabilityGap[] {
  const list = gaps ?? [];
  const key = capabilityGapKey(gap);
  return list.some(existing => capabilityGapKey(existing) === key) ? list : [...list, gap];
}

/** What the Build chat is sent when a missing capability's Add is clicked. */
export function addCapabilityRequest(gap: CapabilityGap): string {
  const trimmed = gap.need.replace(/[.\s]+$/, '');
  // "List your issues" reads as "…can list your issues"; leave "PRs…" alone.
  const need = /^[A-Z][a-z]/.test(trimmed) ? trimmed[0]!.toLowerCase() + trimmed.slice(1) : trimmed;
  return `Add ${gap.capability} so the agent can ${need}.`;
}

/** A connector as the test chat sees it, for {@link inferredCapabilityGaps}. */
export interface GapConnector {
  label: string;
  serverType: string;
  /** Some of its tools (or its subagent) are on the agent. */
  onAgent: boolean;
  /** The user has a key for it, their own or the org's, or it needs none. */
  usable: boolean;
}

/** Other names people use for a connector. */
const CONNECTOR_ALIASES: Readonly<Record<string, readonly string[]>> = {
  google: [
    'gmail',
    'google calendar',
    'google drive',
    'google docs',
    'google sheets',
    'my calendar',
  ],
  microsoft: ['outlook', 'teams', 'onedrive'],
  twitter: ['twitter', 'x.com', 'tweets'],
};

/** Words a model wraps around a connector's name ("the GitHub MCP", "Gmail account"). */
const CONNECTOR_NOISE = /\b(the|my|your|mcp|connector|integration|server|account|tools?|api)\b/gi;

function connectorName(text: string): string {
  return text.toLowerCase().replace(CONNECTOR_NOISE, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * The catalog connector a gap names, if it is one: by label ("GitHub", or the
 * first half of "Google / Gmail"), slug, server type or a common other name
 * ("Gmail" for Google). Gaps that aren't connectors (web search, a skill)
 * match nothing.
 */
export function connectorForGap<T extends { label: string; slug: string; serverType: string }>(
  gap: CapabilityGap,
  connectors: readonly T[],
): T | undefined {
  const name = connectorName(gap.capability);
  if (!name) return undefined;
  return connectors.find(connector => {
    const names = [
      connector.label,
      connector.label.split(' / ')[0]!,
      connector.slug,
      connector.serverType,
      ...(CONNECTOR_ALIASES[connector.serverType] ?? []),
    ].map(connectorName);
    return names.includes(name);
  });
}

/** A gap the test chat answers with Connect: a connector not on the agent, or without a key. */
export function isConnectGap(gap: CapabilityGap): boolean {
  return gap.status === 'not_added' || gap.status === 'not_connected';
}

/** The reply says it couldn't: the moment a gap row should have been reported. */
const COULD_NOT =
  /\b(can't|cannot|can not|couldn't|unable to|don't have|do not have|doesn't have|no access|not available|isn't available|is not available|not connected|isn't connected|not set up|isn't set up|not added|isn't added|once [\w ]{1,40} (is|are) (connected|added|set up))\b/i;

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** "Also check which of these have an open GitHub PR?" → "check which of these have an open GitHub PR". */
export function needFromRequest(request: string): string {
  const need = request
    .trim()
    .replace(/[?.!\s]+$/, '')
    .replace(/^(and |also |so |please |can you |could you |would you |can |could )+/i, '')
    .replace(/^(also |please )+/i, '');
  return need ? need[0]!.toLowerCase() + need.slice(1) : '';
}

/**
 * Gaps for a reply that said it couldn't do something with a product the
 * request named, when the model answered in prose instead of reporting the gap
 * itself. The status comes from the canvas and the user's connections, so it
 * is right even when the model's wording isn't: not on the agent, or on it
 * without a key (both offered as Connect). Products the reply already
 * reported, or that would work, are left alone.
 */
export function inferredCapabilityGaps(
  request: string,
  reply: string,
  connectors: readonly GapConnector[],
  reported: readonly CapabilityGap[] = [],
): CapabilityGap[] {
  if (!COULD_NOT.test(reply)) return [];
  const need = needFromRequest(request);
  if (!need) return [];
  const gaps: CapabilityGap[] = [];
  for (const connector of connectors) {
    const label = connector.label.split(' / ')[0]!.trim();
    const names = [label, ...(CONNECTOR_ALIASES[connector.serverType] ?? [])];
    const named = names.some(name => new RegExp(`\\b${escapeRegExp(name)}\\b`, 'i').test(request));
    if (!named) continue;
    const already = reported.some(gap =>
      gap.capability.toLowerCase().startsWith(label.toLowerCase()),
    );
    if (already) continue;
    const status: CapabilityGapStatus | null = !connector.onAgent
      ? 'not_added'
      : connector.usable
        ? null
        : 'not_connected';
    if (status) gaps.push({ capability: connector.label, status, need });
  }
  return gaps;
}
