/**
 * Per-tool citation attribution: of the tool calls that COULD be cited, how
 * many did the final answer actually cite.
 *
 * This is the one usefulness signal available without an LLM judge, and it
 * needs no new storage. The join already exists in production data:
 * `auto-citations.ts` stamps each tool result chunk with an inline
 * `[clf-<toolCallId>#N]` token, and `appendCitations` only ever appends a
 * trailing block — it never rewrites the answer body — so `agent_runs.result`
 * retains those tokens verbatim. Matching them back to
 * `toolInvocations[].toolCallId` is therefore fully backfillable over history.
 *
 * ── Read the numbers with these limits in mind ────────────────────────────
 * `citeRate` is a SEGMENTED DIAGNOSTIC, never a cross-agent quality score:
 *
 *   - The denominator is CITEABLE calls only — results that actually carry a
 *     token. Tools that structurally cannot be cited (writes, sandbox, todo)
 *     are excluded rather than scored zero, and a tool with no citeable calls
 *     returns `citeRate: null`, not 0.
 *   - Coverage is opt-in. Only retrieval families self-cite by default;
 *     everything else needs the per-agent `autoToolCitations` flag, which is
 *     off by default. `fetchCitationConfig` reports which agents have it on so
 *     the caller can state the sample rather than imply completeness.
 *   - `citationReflection` re-prompts the model until it cites, mechanically
 *     inflating the rate for agents that enable it. Comparing an agent that
 *     has it on against one that does not is meaningless, which is why that
 *     flag is reported alongside.
 *   - Only verbatim token survival counts, so a result that was read and
 *     paraphrased scores as uncited.
 *
 * ── Conversation scoping ──────────────────────────────────────────────────
 * `extractSessionClfTokens` deliberately lets a later turn re-cite an earlier
 * turn's chunk, so a run-scoped join undercounts multi-turn conversations. The
 * cited set is therefore built per conversation (falling back to `sessionId`
 * for automation runs, where `conversationId` is null by design). Citations
 * made in a turn that falls OUTSIDE the queried window are not visible to the
 * query — a window-boundary undercount that shrinks as the window grows.
 */

import { Prisma } from "@prisma/client";
import { prisma } from "../db.js";
import {
  runAnalytics,
  CLF_CAPTURE_RE,
  CLF_TOKEN_RE,
  INVOCATIONS_IS_ARRAY,
  NOT_DROPPED_END,
  RESULT_TEXT,
  windowPredicate,
  type AnalyticsWindow,
} from "./tool-metrics.js";

export interface ToolCiteRow {
  tool: string;
  calls: number;
  /** Calls whose result carried at least one citation token. */
  citeableCalls: number;
  /** Citeable calls whose toolCallId appears in an answer in the same conversation. */
  citedCalls: number;
  /** citedCalls / citeableCalls, or null when nothing was citeable. */
  citeRate: number | null;
}

/**
 * Cite rate per tool over the window.
 *
 * Both the citeable predicate and the cited join run off one materialised
 * unnest. The answer-side scan reads only `agent_runs.result`, which is a
 * plain text column and far cheaper to detoast than the invocations blob.
 */
export async function fetchToolCiteRates(w: AnalyticsWindow, limit = 100): Promise<ToolCiteRow[]> {
  const rows = await runAnalytics<{
    tool: string | null;
    calls: bigint;
    citeable_calls: bigint;
    cited_calls: bigint;
  }>(Prisma.sql`
    WITH scoped AS (
      SELECT
        COALESCE(r."conversationId", r."sessionId")           AS convo,
        r."result"                                           AS answer,
        r."toolInvocations"                                  AS invocations
      FROM "agent_runs" r
      WHERE ${windowPredicate(w)}
        AND ${INVOCATIONS_IS_ARRAY}
    ), cited_ids AS (
      SELECT DISTINCT
        convo,
        (regexp_matches(answer, ${CLF_CAPTURE_RE}, 'g'))[1] AS tool_call_id
      FROM scoped
      WHERE answer IS NOT NULL
        AND answer ~ ${CLF_TOKEN_RE}
    ), inv AS MATERIALIZED (
      SELECT
        s.convo,
        e.value AS v
      FROM scoped s, LATERAL jsonb_array_elements(s.invocations) e(value)
    )
    SELECT
      v->>'toolName'                                   AS tool,
      count(*)                                         AS calls,
      count(*) FILTER (WHERE citeable)                 AS citeable_calls,
      count(*) FILTER (WHERE citeable AND cited)       AS cited_calls
    FROM (
      SELECT
        v,
        ${RESULT_TEXT} ~ ${CLF_TOKEN_RE} AS citeable,
        EXISTS (
          SELECT 1 FROM cited_ids c
          WHERE c.convo = inv.convo
            AND c.tool_call_id = v->>'toolCallId'
        ) AS cited
      FROM inv
      WHERE ${NOT_DROPPED_END}
        AND v->>'toolName' IS NOT NULL
    ) classified
    GROUP BY 1
    ORDER BY citeable_calls DESC, calls DESC
    LIMIT ${limit}
  `);

  return rows.map((r) => {
    const citeable = Number(r.citeable_calls);
    const cited = Number(r.cited_calls);
    return {
      tool: r.tool ?? "(unknown)",
      calls: Number(r.calls),
      citeableCalls: citeable,
      citedCalls: cited,
      citeRate: citeable > 0 ? cited / citeable : null,
    };
  });
}

export interface CitationConfigRow {
  agentSlug: string;
  autoToolCitations: boolean;
  citationReflection: boolean;
}

/**
 * Which agents have the two citation flags enabled.
 *
 * Read with `->>` so that both storage shapes are covered: the runtime accepts
 * `true` and the string `"true"` (the free-form config editor stores strings),
 * and `->>` renders a JSON boolean and a JSON string identically as `'true'`.
 *
 * Note the effective value of `autoToolCitations` is also forced on for
 * daily-brief runs regardless of config, so a segment built on this column
 * alone slightly understates coverage for that flow.
 */
export async function fetchCitationConfig(agentSlugs?: string[]): Promise<CitationConfigRow[]> {
  const agents = await prisma.agent.findMany({
    where: agentSlugs?.length ? { slug: { in: agentSlugs } } : {},
    select: { slug: true, config: true },
  });

  const flag = (config: unknown, key: string): boolean => {
    const value = (config as Record<string, unknown> | null)?.[key];
    return value === true || value === "true";
  };

  return agents.map((a) => ({
    agentSlug: a.slug,
    autoToolCitations: flag(a.config, "autoToolCitations"),
    citationReflection: flag(a.config, "citationReflection"),
  }));
}


export interface CitationReflectionRow {
  outcome: string;
  runs: number;
  share: number;
}

/**
 * Run-level distribution of the citation-reflection outcome
 * (`already_cited` / `no_citeable_sources` / `fixed_after_nudge` /
 * `still_uncited` / `aborted`).
 *
 * Complements the per-tool cite rate with the question it cannot answer: of the
 * runs that HAD citeable sources, how many actually used them, and how many only
 * did so after being nudged. `fixed_after_nudge` is the load-bearing bucket —
 * a large share there means the cite rate is being manufactured by the nudge
 * rather than earned by the model.
 *
 * Reads `agent_runs.metadata`, never the invocations blob, so it costs nothing
 * beyond the window scan. Only runs whose agent has citationReflection enabled
 * carry the key at all.
 */
export async function fetchCitationReflection(w: AnalyticsWindow): Promise<CitationReflectionRow[]> {
  const rows = await runAnalytics<{ outcome: string | null; runs: bigint }>(Prisma.sql`
    SELECT
      r."metadata"->'citationReflection'->>'outcome' AS outcome,
      count(*)                                       AS runs
    FROM "agent_runs" r
    WHERE ${windowPredicate(w)}
      AND r."metadata"->'citationReflection' IS NOT NULL
    GROUP BY 1
    ORDER BY runs DESC
  `);

  const total = rows.reduce((acc, r) => acc + Number(r.runs), 0);
  return rows.map((r) => ({
    outcome: r.outcome ?? "(unknown)",
    runs: Number(r.runs),
    share: total > 0 ? Number(r.runs) / total : 0,
  }));
}
