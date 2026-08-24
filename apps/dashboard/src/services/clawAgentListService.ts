/**
 * Service for fetching the list of claw agents accessible to the current user.
 * These are the agents shown in the global Agent Selector (sidebar + input box).
 */
import { apiInstance } from './clients/apiClient';

export interface AccessibleClawAgent {
  slug: string;
  name: string;
  color: string;
  description?: string;
  tools?: string[];
  skills?: string[];
  subagents?: string[];
  /** KB scoping mode (mirrors xyne-claw-auth `Agent.kbScope`).
   *  "COLLECTIONS" — explicit allowlist via `collections`.
   *  "USER"        — agent inherits the running user's spaces KB. */
  kbScope?: 'COLLECTIONS' | 'USER';
  /** Per-agent KB grants used by the ask-ai v2 context picker.
   *   • `collectionId`     — original immediate-parent (root OR sub-folder).
   *                          Used for in-collection drill-down gating.
   *   • `fileId === null`  — whole-collection grant on `collectionId`.
   *   • `fileId` set       — single-file grant.
   *   • `rootCollectionId` — resolved root for `collectionId`. The top-level
   *                          picker only lists roots, so filter on this. */
  collections?: Array<{
    collectionId: string;
    fileId: string | null;
    rootCollectionId: string;
  }>;
  /** When true, every chat request to this agent always runs the single-
   *  search/single-answer instant KB path — the composer shows a locked
   *  "Instant" indicator for it instead of the normal per-message toggle. */
  instantAgent?: boolean;
  /** True when the agent has fast mode configured (fast-mode provider profile
   *  and/or a default speed in its model settings). Gates the composer's
   *  ⚡ Fast mode toggle — agents without it show no fast-mode affordance. */
  fastModeConfigured?: boolean;
}

export async function fetchAccessibleClawAgents(): Promise<AccessibleClawAgent[]> {
  const response = await apiInstance.get<{ success: boolean; data: AccessibleClawAgent[] }>(
    '/xyne-ai/agents',
  );
  const result = response.data;
  if (!result.success) {
    throw new Error('Failed to fetch agents');
  }
  return result.data;
}
