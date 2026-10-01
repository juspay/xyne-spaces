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
export function withCapabilityGap(gaps: CapabilityGap[] | undefined, gap: CapabilityGap): CapabilityGap[] {
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
