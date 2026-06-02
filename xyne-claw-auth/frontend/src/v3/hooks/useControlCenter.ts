import { useState, useEffect, useRef, useCallback } from "react";
import { frontendConfig } from "../../lib/config";
import {
  getControlCenterMetrics,
  getControlCenterAgents,
  getControlCenterFailures,
  listControlCenterApprovals,
  listRuns,
} from "../../lib/api";
import type {
  ControlCenterMetrics,
  ControlCenterAgent,
  ControlCenterFailure,
  Approval,
  AgentRun,
} from "../../lib/api";

export interface UseControlCenterReturn {
  metrics: ControlCenterMetrics | null;
  agents: ControlCenterAgent[];
  failures: ControlCenterFailure[];
  approvals: Approval[];
  runs: AgentRun[];
  loading: boolean;
  sseConnected: boolean;
  reload: () => void;
}

export function useControlCenter(userId: string): UseControlCenterReturn {
  const [metrics, setMetrics] = useState<ControlCenterMetrics | null>(null);
  const [agents, setAgents] = useState<ControlCenterAgent[]>([]);
  const [failures, setFailures] = useState<ControlCenterFailure[]>([]);
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [runs, setRuns] = useState<AgentRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [sseConnected, setSseConnected] = useState(false);
  const sseRef = useRef<EventSource | null>(null);

  const fetchAll = useCallback(async () => {
    try {
      const [
        metricsRes,
        agentsRes,
        failuresRes,
        approvalsRes,
        runsRes,
      ] = await Promise.allSettled([
        getControlCenterMetrics(),
        getControlCenterAgents(50),
        getControlCenterFailures(10),
        listControlCenterApprovals(),
        listRuns(userId, { limit: 200 }),
      ]);

      if (metricsRes.status === "fulfilled") setMetrics(metricsRes.value);
      if (agentsRes.status === "fulfilled") setAgents(agentsRes.value);
      if (failuresRes.status === "fulfilled") setFailures(failuresRes.value);
      if (approvalsRes.status === "fulfilled") {
        setApprovals(approvalsRes.value.filter((a) => a.status === "pending"));
      }
      if (runsRes.status === "fulfilled") setRuns(runsRes.value);
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    const es = new EventSource(
      `${frontendConfig.clawApiBaseUrl}/api/v1/control-center/events`,
      { withCredentials: true },
    );
    sseRef.current = es;

    es.onopen = () => setSseConnected(true);
    es.onerror = () => setSseConnected(false);

    es.onmessage = (e) => {
      try {
        const event = JSON.parse(e.data as string) as { type: string };
        if (
          event.type === "agent_progress" ||
          event.type === "agent_done" ||
          event.type === "agent_start"
        ) {
          void fetchAll();
        }
      } catch {
        // Ignore malformed events
      }
    };

    const safetyPoll = setInterval(() => {
      void fetchAll();
    }, 60_000);

    void fetchAll();

    return () => {
      es.close();
      clearInterval(safetyPoll);
    };
  }, [fetchAll]);

  return {
    metrics,
    agents,
    failures,
    approvals,
    runs,
    loading,
    sseConnected,
    reload: fetchAll,
  };
}
