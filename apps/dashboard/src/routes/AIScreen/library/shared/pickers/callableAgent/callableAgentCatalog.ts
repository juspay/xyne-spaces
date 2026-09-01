import type { DelegationStatus } from '@/services/claw/clawDelegationTypes';
import type { PillTone } from '../../primitives/Pill';
import type { Agent } from '@/services/claw/clawAuthAgentTypes';

export interface CallableAgentEntry {
  slug: string;
  name: string;
  description: string;
  ownerName: string | null;
  /** Null until the agent is added; `missing` = in config with no grant behind it. */
  status: DelegationStatus | 'missing' | null;
  /** The callee has another owner, so the request needs a reason and approval. */
  needsApproval: boolean;
  /** Null for a slug the user can no longer see — the row still has to render. */
  agent: Agent | null;
}

export function matchesSearch(entry: CallableAgentEntry, query: string): boolean {
  if (!query) return true;
  return `${entry.name} ${entry.slug} ${entry.description}`.toLowerCase().includes(query);
}

export function statusPill(
  status: CallableAgentEntry['status'],
): { tone: PillTone; label: string } | null {
  switch (status) {
    case 'approved':
      return { tone: 'success', label: 'Enabled' };
    case 'pending':
      return { tone: 'warning', label: 'Awaiting approval' };
    case 'rejected':
      return { tone: 'danger', label: 'Declined' };
    case 'missing':
      return { tone: 'neutral', label: 'No grant' };
    default:
      return null;
  }
}
