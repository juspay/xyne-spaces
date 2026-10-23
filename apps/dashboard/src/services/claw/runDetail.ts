import type { AgentRun, AgentRunSource } from './clawRunsTypes';

export const RUN_SOURCE_LABEL: Record<AgentRunSource, string> = {
  automation: 'Automation',
  scheduled: 'Scheduled',
  people: 'Person',
  workflow: 'Workflow step',
  delegated: 'Called by agent',
  awakening: 'Awakening',
};

export function formatRunDuration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || ms < 0) return '—';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

export function runElapsedMs(
  run: Pick<AgentRun, 'startedAt' | 'completedAt'>,
  now: number = Date.now(),
): number | null {
  const started = Date.parse(run.startedAt);
  if (Number.isNaN(started)) return null;
  const ended = run.completedAt ? Date.parse(run.completedAt) : now;
  return Number.isNaN(ended) ? null : Math.max(0, ended - started);
}

export interface RunTimeSplit {
  readonly llmMs: number;
  readonly toolMs: number;
  readonly llmShare: number;
}

export function runTimeSplit(run: Pick<AgentRun, 'llmTotalMs' | 'toolMs'>): RunTimeSplit | null {
  const llmMs = Math.max(0, run.llmTotalMs ?? 0);
  const toolMs = Math.max(0, run.toolMs ?? 0);
  const total = llmMs + toolMs;
  if (total === 0) return null;
  return { llmMs, toolMs, llmShare: llmMs / total };
}

export function runModelLabel(run: Pick<AgentRun, 'model' | 'provider'>): string {
  if (!run.model) return '—';
  return run.provider ? `${run.model} · ${run.provider}` : run.model;
}

export function runTraceHref(
  run: Pick<AgentRun, 'sessionId' | 'agentSlug' | 'conversationId' | 'triggerSource'>,
): string | null {
  if (run.triggerSource !== 'chat' || !run.conversationId) return null;
  const params = new URLSearchParams({ debugRun: run.sessionId, debugAgent: run.agentSlug });
  return `/ai/chat/${encodeURIComponent(run.conversationId)}?${params.toString()}`;
}
