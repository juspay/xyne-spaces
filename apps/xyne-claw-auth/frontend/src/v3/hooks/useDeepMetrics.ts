/**
 * Fetchers for the deep tool + LLM-call metrics endpoints.
 *
 * Each hook takes an `enabled` flag so a panel only fetches while its tab is
 * open. The page has four detail tabs; loading all of them on mount would
 * quadruple the request cost for data the reader may never look at.
 *
 * The agent selection is a multi-select; the key joins it so widening or
 * narrowing the selection refetches, and an unchanged selection does not.
 *
 * Requests are keyed by their full parameter set. The key — not the callback
 * identity — drives the effect, so an inline `() => fetchX(...)` at the call
 * site cannot cause a refetch loop. In-flight responses for a stale key are
 * discarded rather than applied, and the previous data is held while a refetch
 * runs so a filter change does not blank the panel.
 */

import { useEffect, useRef, useState } from "react";
import {
  fetchLlmCallMetrics,
  fetchToolFailures,
  fetchToolCoverageMetrics,
  fetchToolMetrics,
  fetchToolQualityMetrics,
  type AdminOrgScope,
  type LlmCallMetrics,
  type ToolCoverageMetrics,
  type ToolFailuresResponse,
  type ToolMetrics,
  type ToolPageRequest,
  type ToolQualityMetrics,
} from "../../lib/api";

export type MetricsDays = 1 | 7 | 30;

export interface DeepMetricState<T> {
  data: T | undefined;
  loading: boolean;
  error: string | null;
}

function useDeepMetric<T>(
  key: string,
  load: () => Promise<T>,
  enabled: boolean,
): DeepMetricState<T> {
  const [state, setState] = useState<DeepMetricState<T>>({
    data: undefined,
    loading: false,
    error: null,
  });

  // Held in a ref so a fresh closure per render never re-triggers the effect.
  const loadRef = useRef(load);
  loadRef.current = load;

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    setState((prev) => ({ ...prev, loading: true, error: null }));
    loadRef
      .current()
      .then((data) => {
        if (!cancelled) setState({ data, loading: false, error: null });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setState({
          data: undefined,
          loading: false,
          error: err instanceof Error ? err.message : String(err),
        });
      });
    return () => {
      cancelled = true;
    };
  }, [key, enabled]);

  return state;
}

/** Serialises a page request into the cache key so sort/page/search refetch. */
function pageKey(page: ToolPageRequest): string {
  return `${page.limit}|${page.offset}|${page.sort}|${page.dir}|${page.search ?? ""}`;
}

export function useToolMetrics(
  userId: string,
  days: MetricsDays,
  orgScope: AdminOrgScope,
  agentSlugs: readonly string[],
  page: ToolPageRequest,
  enabled: boolean,
): DeepMetricState<ToolMetrics> {
  return useDeepMetric(
    `tools|${userId}|${days}|${orgScope}|${agentSlugs.join(",")}|${pageKey(page)}`,
    () => fetchToolMetrics(userId, days, orgScope, agentSlugs, page),
    enabled,
  );
}

/**
 * Every failure class for one tool.
 *
 * Only fetched once a tool is picked — `enabled` is false until then, so the
 * drill-down costs nothing while the overview card is all that is on screen.
 */
export function useToolFailures(
  userId: string,
  tool: string | null,
  days: MetricsDays,
  orgScope: AdminOrgScope,
  agentSlugs: readonly string[],
  page: { limit: number; offset: number },
): DeepMetricState<ToolFailuresResponse> {
  return useDeepMetric(
    `failures|${userId}|${tool ?? ""}|${days}|${orgScope}|${agentSlugs.join(",")}|${page.limit}|${page.offset}`,
    () => fetchToolFailures(userId, tool ?? "", days, orgScope, agentSlugs, page),
    tool !== null,
  );
}

export function useToolQualityMetrics(
  userId: string,
  days: MetricsDays,
  orgScope: AdminOrgScope,
  agentSlugs: readonly string[],
  exact: boolean,
  page: ToolPageRequest,
  enabled: boolean,
): DeepMetricState<ToolQualityMetrics> {
  return useDeepMetric(
    `quality|${userId}|${days}|${orgScope}|${agentSlugs.join(",")}|${exact}|${pageKey(page)}`,
    () => fetchToolQualityMetrics(userId, days, orgScope, agentSlugs, exact, page),
    enabled,
  );
}

export function useToolCoverageMetrics(
  userId: string,
  days: MetricsDays,
  orgScope: AdminOrgScope,
  agentSlugs: readonly string[],
  enabled: boolean,
): DeepMetricState<ToolCoverageMetrics> {
  return useDeepMetric(
    `coverage|${userId}|${days}|${orgScope}|${agentSlugs.join(",")}`,
    () => fetchToolCoverageMetrics(userId, days, orgScope, agentSlugs),
    enabled,
  );
}

export function useLlmCallMetrics(
  userId: string,
  days: MetricsDays,
  orgScope: AdminOrgScope,
  agentSlugs: readonly string[],
  includeSubagents: boolean,
  enabled: boolean,
): DeepMetricState<LlmCallMetrics> {
  return useDeepMetric(
    `llm|${userId}|${days}|${orgScope}|${agentSlugs.join(",")}|${includeSubagents}`,
    () => fetchLlmCallMetrics(userId, days, orgScope, agentSlugs, { includeSubagents }),
    enabled,
  );
}
