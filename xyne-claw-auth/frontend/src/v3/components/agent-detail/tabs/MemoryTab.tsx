/**
 * V3 MemoryTab — thin wrapper around the V2 (V1-shared) MemoryTab
 * implementation. The V2 component is feature-complete: enrolment toggle,
 * stats, hot/pending/candidates/graph/recall-tester sub-views, and
 * backfill modal. Rebuilding it in V3 would duplicate ~1700 LOC for no
 * functional gain.
 *
 * Props:
 *   agentSlug  — required for every memory bank API call (/banks/:slug/*)
 *   canDelete  — gates the trash buttons on individual memory rows; in V3
 *                this maps to the agent permissions' canEdit flag.
 *
 * Known caveat: the V2 component is styled with the dark `zinc-*` palette
 * rather than V3's `xyne-*` tokens, so it visually drifts from the rest
 * of V3 in light mode. Re-styling is a future pass — the goal here is
 * functional alignment with V1 (the user explicitly asked for it).
 */
import { MemoryTab as MemoryTabV2 } from "../../../../v2/components/MemoryTab";

interface Props {
  agentSlug: string;
  canDelete?: boolean;
}

export function MemoryTab({ agentSlug, canDelete = false }: Props) {
  return <MemoryTabV2 agentSlug={agentSlug} canDelete={canDelete} />;
}
