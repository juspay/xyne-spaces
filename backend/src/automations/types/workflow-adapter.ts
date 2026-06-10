import { WorkflowEventType, type Workflow, type WorkflowExecution } from '@prisma/client';
import { AutomationStatus, AutomationRunStatus } from './status';
import type { AutomationConfig } from './automation-config';

export const AUTOMATION_WORKFLOW_TYPE = 'Automations';

export interface AutomationView {
  id: string;
  workspaceId: string;
  name: string;
  description: string | null;
  status: AutomationStatus;
  config: AutomationConfig;
  createdById: string;
  createdAt: Date;
  updatedAt: Date;
  automationSeriesId: string | null;
}

export interface AutomationRunView {
  id: string;
  automationId: string;
  status: AutomationRunStatus;
  triggerData: Record<string, unknown>;
  context: Record<string, unknown>;
  error: string | null;
  startedAt: Date;
  completedAt: Date | null;
}

interface AutomationMetadata {
  description: string | null;
  createdById: string;
}

export function triggerTypeToEventType(triggerType: string): WorkflowEventType {
  const candidate = triggerType as WorkflowEventType;
  return (Object.values(WorkflowEventType) as string[]).includes(triggerType)
    ? candidate
    : WorkflowEventType.NO_OP;
}

export function parseAutomationMetadata(raw: string | null): AutomationMetadata {
  if (!raw) return { description: null, createdById: '' };
  try {
    const parsed = JSON.parse(raw) as Partial<AutomationMetadata>;
    return {
      description: parsed.description ?? null,
      createdById: parsed.createdById ?? '',
    };
  } catch {
    return { description: null, createdById: '' };
  }
}

export function buildAutomationMetadata(input: AutomationMetadata): string {
  return JSON.stringify(input);
}

export function workflowToAutomation(workflow: Workflow): AutomationView {
  const metadata = parseAutomationMetadata(workflow.metadata);
  return {
    id: workflow.id,
    workspaceId: workflow.workspaceId,
    name: workflow.workflowName ?? '',
    description: metadata.description,
    status: (workflow.status as AutomationStatus) || AutomationStatus.DRAFT,
    config: parseAutomationConfig(workflow.context),
    createdById: metadata.createdById,
    createdAt: workflow.createdAt,
    updatedAt: workflow.updatedAt,
    automationSeriesId: workflow.automationSeriesId ?? null,
  };
}

export function parseAutomationConfig(raw: string | null): AutomationConfig {
  if (!raw) return { trigger: { type: '', config: {} }, steps: [] };
  try {
    return JSON.parse(raw) as AutomationConfig;
  } catch {
    return { trigger: { type: '', config: {} }, steps: [] };
  }
}

export function readAutomationMeta(
  contextRaw: string | null,
): { error: string | null; chain: readonly string[] } {
  if (!contextRaw) return { error: null, chain: [] };
  try {
    const parsed = JSON.parse(contextRaw) as { __meta?: { error?: string | null; chain?: readonly string[] } };
    return {
      error: parsed.__meta?.error ?? null,
      chain: parsed.__meta?.chain ?? [],
    };
  } catch {
    return { error: null, chain: [] };
  }
}

export function parseExecutionTriggerData(raw: string | null): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return parsed ?? {};
  } catch {
    return {};
  }
}

export function workflowExecutionToRun(
  execution: WorkflowExecution,
  state: { context: string | null } | null,
): AutomationRunView {
  const ctx = parseExecutionTriggerData(state?.context ?? null);
  const meta = (ctx['__meta'] as { error?: string | null } | undefined) ?? {};
  const userCtx: Record<string, unknown> = { ...ctx };
  delete userCtx['__meta'];
  const trigger = (ctx['trigger'] as { data?: Record<string, unknown> } | undefined) ?? {};
  const triggerData = trigger.data ?? {};
  return {
    id: execution.id,
    automationId: execution.workflowId,
    status: (execution.status as AutomationRunStatus) || AutomationRunStatus.RUNNING,
    triggerData,
    context: userCtx,
    error: meta.error ?? null,
    startedAt: execution.createdAt,
    completedAt:
      execution.status === AutomationRunStatus.RUNNING ||
      execution.status === AutomationRunStatus.SCHEDULED ||
      execution.status === 'EXTERNAL_WAIT'
        ? null
        : execution.updatedAt,
  };
}
