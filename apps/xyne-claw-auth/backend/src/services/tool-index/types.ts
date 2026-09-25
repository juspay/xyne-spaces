/**
 * Tool index — a Hindsight bank holding one searchable document per row of the
 * `tools` table, for finding tools by need rather than browsing the catalog.
 *
 * Runs in `chunks` extraction mode: content stored verbatim, no LLM on the
 * write or read path. See `bank.ts`.
 *
 * One bank, not one per org — `Tool.slug` is globally `@unique` and the table
 * has no `orgId`. Tenant-specific facets (credentials held, grants) are applied
 * by the caller against its own context, not baked into the bank.
 */

/** What an entry describes. One kind today; the tag leaves room for more. */
export const TOOL_INDEX_KINDS = ["tool"] as const;
export type ToolIndexKind = (typeof TOOL_INDEX_KINDS)[number];

import type { ToolRiskLevel } from "xyne-claw-shared";

export type RiskLevel = ToolRiskLevel;

export interface ToolRow {
  slug: string;
  name: string;
  description: string;
  source: string;
  inputSchema: unknown;
  enabled: boolean;
  updatedAt: Date;
}

/** One renderable document for one tool. */
export interface ToolBlob {
  slug: string;
  content: string;
  /** Deterministic over `content` — lets sync skip unchanged tools. */
  contentHash: string;
  tags: string[];
  metadata: Record<string, string>;
}

export interface ToolParam {
  name: string;
  type: string;
  required: boolean;
  description: string;
}

/** One tool ranked against a need. */
export interface ToolMatch {
  slug: string;
  name: string;
  /** `custom:google` → `google`. The grouping a human recognises. */
  integration: string;
  description: string;
  risk: RiskLevel;
  params: ToolParam[];
  /** Hindsight's fused score. Comparable within one search, never across. */
  score: number;
  /** Count of agents in the caller's org with this granted; computed at search
   *  time from live rows, never embedded — see `search.ts`. */
  grantedToAgents?: number;
}

export interface ToolSyncOutcome {
  written: number;
  skipped: number;
  removed: number;
  failed: number;
}
