import { type Workflow, type WorkflowExecution } from '@prisma/client';
import { WorkflowEventType } from '@xyne/shared';
import { AutomationStatus, AutomationRunStatus } from './status';
import type { AutomationConfig } from './automation-config';

export const AUTOMATION_WORKFLOW_TYPE = 'Automations';
/** Personal desk auto-label rules — not listed or synced via Automations Zero queries. */
export const DESK_AUTOMATION_WORKFLOW_TYPE = 'DeskAutomations';

export function isExecutableAutomationWorkflowType(workflowType: string | null | undefined): boolean {
  return (
    workflowType === AUTOMATION_WORKFLOW_TYPE || workflowType === DESK_AUTOMATION_WORKFLOW_TYPE
  );
}

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
  eventType: WorkflowEventType;
}

/** What the run-history list renders. No context blobs — see AutomationRunView. */
export interface AutomationRunSummaryView {
  id: string;
  automationId: string;
  status: AutomationRunStatus;
  error: string | null;
  startedAt: Date;
  completedAt: Date | null;
}

export interface AutomationRunView extends AutomationRunSummaryView {
  triggerData: Record<string, unknown>;
  context: Record<string, unknown>;
}

interface AutomationMetadata {
  description: string | null;
  createdById: string;
  drainInFlight?: boolean;
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
      ...(parsed.drainInFlight ? { drainInFlight: true } : {}),
    };
  } catch {
    return { description: null, createdById: '' };
  }
}

export function buildAutomationMetadata(input: AutomationMetadata): string {
  return JSON.stringify(input);
}

export function mayDrainInFlight(workflow: Workflow): boolean {
  return (
    workflow.status === AutomationStatus.DISABLED &&
    parseAutomationMetadata(workflow.metadata).drainInFlight === true
  );
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
    eventType: triggerTypeToEventType(workflow.eventType),
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

/** The execution columns a run summary needs — lets the list query select just these. */
type WorkflowExecutionRunFields = Pick<
  WorkflowExecution,
  'id' | 'workflowId' | 'status' | 'createdAt' | 'updatedAt'
>;

export function workflowExecutionToRunSummary(
  execution: WorkflowExecutionRunFields,
  state: { context: string | null } | null,
): AutomationRunSummaryView {
  const ctx = parseExecutionTriggerData(state?.context ?? null);
  const meta = (ctx['__meta'] as { error?: string | null } | undefined) ?? {};
  return {
    id: execution.id,
    automationId: execution.workflowId,
    status: (execution.status as AutomationRunStatus) || AutomationRunStatus.RUNNING,
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

export function workflowExecutionToRun(
  execution: WorkflowExecution,
  state: { context: string | null } | null,
): AutomationRunView {
  const ctx = parseExecutionTriggerData(state?.context ?? null);
  const userCtx: Record<string, unknown> = { ...ctx };
  delete userCtx['__meta'];
  const trigger = (ctx['trigger'] as { data?: Record<string, unknown> } | undefined) ?? {};
  return {
    ...workflowExecutionToRunSummary(execution, state),
    triggerData: trigger.data ?? {},
    context: userCtx,
  };
}
