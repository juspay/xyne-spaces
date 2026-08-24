/**
 * Fetchers for the deep tool + LLM-call metrics endpoints.
 *
 * Each hook takes an `enabled` flag so a panel only fetches while its tab is
 * open. The page has four detail tabs; loading all of them on mount would
 * quadruple the request cost for data the reader may never look at.
 *
 * Requests are keyed by their full parameter set — window, scope, page, chart.
 * The key, not the callback identity, drives the effect, so an inline
 * `() => fetchX(...)` at the call site cannot cause a refetch loop. In-flight
 * responses for a stale key are discarded rather than applied, and the previous
 * data is held while a refetch runs so a filter change does not blank the panel.
 */

import { useEffect, useRef, useState } from "react";
import {
  fetchLlmCallMetrics,
  fetchToolCoverageMetrics,
  fetchToolFailures,
  fetchToolMetrics,
  fetchToolQualityMetrics,
  fetchSessionSummary,
  type AdminOrgScope,
  type ChartRequest,
  type DeepMetricsFilters,
  type LlmCallMetrics,
  type ToolCoverageMetrics,
  type ToolFailuresResponse,
  type ToolMetrics,
  type ToolPageRequest,
  type ToolQualityMetrics,
  type SessionSummary,
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

/** Every filter that changes the answer, flattened into a cache key. */
function filterKey(userId: string, f: DeepMetricsFilters): string {
  return [
    userId,
    f.days,
    f.from ?? "",
    f.to ?? "",
    f.orgScope ?? "org",
    (f.agentSlugs ?? []).join("+"),
    f.sessionId ?? "",
  ].join("|");
}

function pageKey(page: ToolPageRequest): string {
  return `${page.limit}|${page.offset}|${page.sort}|${page.dir}|${page.search ?? ""}`;
}

export function useToolMetrics(
  userId: string,
  filters: DeepMetricsFilters,
  page: ToolPageRequest,
  chart: ChartRequest,
  enabled: boolean,
): DeepMetricState<ToolMetrics> {
  return useDeepMetric(
    `tools|${filterKey(userId, filters)}|${pageKey(page)}|${chart.measure}|${chart.aggregation}`,
    () => fetchToolMetrics(userId, filters, page, chart),
    enabled,
  );
}

export function useToolQualityMetrics(
  userId: string,
  filters: DeepMetricsFilters,
  exact: boolean,
  page: ToolPageRequest,
  enabled: boolean,
): DeepMetricState<ToolQualityMetrics> {
  return useDeepMetric(
    `quality|${filterKey(userId, filters)}|${exact}|${pageKey(page)}`,
    () => fetchToolQualityMetrics(userId, filters, exact, page),
    enabled,
  );
}

export function useToolCoverageMetrics(
  userId: string,
  filters: DeepMetricsFilters,
  enabled: boolean,
): DeepMetricState<ToolCoverageMetrics> {
  return useDeepMetric(
    `coverage|${filterKey(userId, filters)}`,
    () => fetchToolCoverageMetrics(userId, filters),
    enabled,
  );
}

export function useLlmCallMetrics(
  userId: string,
  filters: DeepMetricsFilters,
  includeSubagents: boolean,
  enabled: boolean,
): DeepMetricState<LlmCallMetrics> {
  return useDeepMetric(
    `llm|${filterKey(userId, filters)}|${includeSubagents}`,
    () => fetchLlmCallMetrics(userId, filters, { includeSubagents }),
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
  filters: DeepMetricsFilters,
  page: { limit: number; offset: number },
): DeepMetricState<ToolFailuresResponse> {
  return useDeepMetric(
    `failures|${tool ?? ""}|${filterKey(userId, filters)}|${page.limit}|${page.offset}`,
    () => fetchToolFailures(userId, tool ?? "", filters, page),
    tool !== null,
  );
}

/** The run behind a session filter. Not fetched until one is entered. */
export function useSessionSummary(
  userId: string,
  sessionId: string,
  orgScope: AdminOrgScope,
): DeepMetricState<SessionSummary> {
  return useDeepMetric(
    `session|${userId}|${sessionId}|${orgScope}`,
    () => fetchSessionSummary(userId, sessionId, orgScope),
    sessionId.length > 0,
  );
}
