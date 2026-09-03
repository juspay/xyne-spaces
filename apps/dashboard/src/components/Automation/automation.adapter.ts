import type { Workflow } from '@xyne/shared';
import { WorkflowEventType } from '@xyne/shared';
import type { Automation, AutomationConfig, AutomationStatus } from './Automation.types';
import { AutomationStatusValues } from './Automation.types';

export const AUTOMATION_WORKFLOW_TYPE = 'Automations';

export function triggerTypeToEventType(triggerType: string): WorkflowEventType {
  return isWorkflowEventType(triggerType) ? triggerType : WorkflowEventType.NO_OP;
}

interface AutomationMetadata {
  description: string | null;
  createdById: string;
}

function parseMetadata(raw: string | null | undefined): AutomationMetadata {
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

function parseConfig(raw: string | null | undefined): AutomationConfig {
  if (!raw) return { trigger: { type: '', config: {} }, steps: [] };
  try {
    return JSON.parse(raw) as AutomationConfig;
  } catch {
    return { trigger: { type: '', config: {} }, steps: [] };
  }
}

function toIsoString(value: number | string | Date | null | undefined): string {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'number') return new Date(value).toISOString();
  return value;
}

export function workflowToAutomation(workflow: Workflow): Automation {
  const metadata = parseMetadata(workflow.metadata);
  return {
    id: workflow.id,
    name: workflow.workflowName ?? '',
    description: metadata.description,
    status: (workflow.status as AutomationStatus) || AutomationStatusValues.DRAFT,
    config: parseConfig(workflow.context),
    createdById: metadata.createdById,
    createdAt: toIsoString(workflow.createdAt),
    updatedAt: toIsoString(workflow.updatedAt),
    automationSeriesId: workflow.automationSeriesId ?? null,
    eventType: isWorkflowEventType(workflow.eventType)
      ? workflow.eventType
      : WorkflowEventType.NO_OP,
  };
}

function isWorkflowEventType(value: string | null | undefined): value is WorkflowEventType {
  return !!value && (Object.values(WorkflowEventType) as string[]).includes(value);
}

export function isAutomationWorkflow(workflow: Workflow): boolean {
  return workflow.workflowType === AUTOMATION_WORKFLOW_TYPE;
}
