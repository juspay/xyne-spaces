import { WorkflowEventType } from '@xyne/shared';
import { apiInstance } from '../services/clients/apiClient';

interface SuccessEnvelope<T> {
  success: true;
  data: T;
  timestamp?: string;
}

export const AutomationStatusValues = {
  DRAFT: 'DRAFT',
  ACTIVE: 'ACTIVE',
  DISABLED: 'DISABLED',
  PENDING_APPROVAL: 'PENDING_APPROVAL',
  REJECTED: 'REJECTED',
  REVOKED: 'REVOKED',
  AUTO_REVOKED: 'AUTO_REVOKED',
  ARCHIVED: 'ARCHIVED',
} as const;
export type AutomationStatus = (typeof AutomationStatusValues)[keyof typeof AutomationStatusValues];

/** A status that corresponds to the canonical LIVE row in a lineage. */
export function isLiveStatus(status: string): boolean {
  return status === AutomationStatusValues.ACTIVE || status === AutomationStatusValues.DISABLED;
}

/** A status that corresponds to a proposal row (any lifecycle stage of one). */
export function isProposalStatus(status: string): boolean {
  return (
    status === AutomationStatusValues.DRAFT ||
    status === AutomationStatusValues.PENDING_APPROVAL ||
    status === AutomationStatusValues.REJECTED ||
    status === AutomationStatusValues.REVOKED ||
    status === AutomationStatusValues.AUTO_REVOKED
  );
}

/** Terminal proposal status — the row will never transition again. */
export function isTerminalProposalStatus(status: string): boolean {
  return (
    status === AutomationStatusValues.REJECTED ||
    status === AutomationStatusValues.REVOKED ||
    status === AutomationStatusValues.AUTO_REVOKED
  );
}

export const AutomationRunStatusValues = {
  PENDING: 'PENDING',
  SCHEDULED: 'SCHEDULED',
  RUNNING: 'RUNNING',
  EXTERNAL_WAIT: 'EXTERNAL_WAIT',
  COMPLETED: 'COMPLETED',
  FAILED: 'FAILED',
  CANCELLED: 'CANCELLED',
  SKIPPED: 'SKIPPED',
} as const;
export type AutomationRunStatus =
  (typeof AutomationRunStatusValues)[keyof typeof AutomationRunStatusValues];

export const StepKindValues = {
  ACTION: 'ACTION',
  CONTROL_FLOW: 'CONTROL_FLOW',
} as const;
export type StepKind = (typeof StepKindValues)[keyof typeof StepKindValues];

export interface OperatorMeta {
  value: string;
  label: string;
  valueType: 'string' | 'number' | 'boolean' | 'none' | 'tag';
}

export interface TriggerCatalogItem {
  type: string;
  name: string;
  description: string;
  category: string;
  icon?: string;
}

export interface StepCatalogItem {
  type: string;
  name: string;
  description: string;
  category: string;
  kind: StepKind;
  icon?: string;
}

export type JsonSchema = {
  $schema?: string;
  $ref?: string;
  type?: 'string' | 'number' | 'integer' | 'boolean' | 'array' | 'object' | 'null';
  description?: string;
  format?: string;
  enum?: unknown[];
  default?: unknown;
  required?: string[];
  properties?: Record<string, JsonSchema>;
  items?: JsonSchema | JsonSchema[];
  additionalProperties?: boolean | JsonSchema;
  anyOf?: JsonSchema[];
  oneOf?: JsonSchema[];
  allOf?: JsonSchema[];
  minLength?: number;
  maxLength?: number;
  minimum?: number;
  maximum?: number;
  pattern?: string;
  definitions?: Record<string, JsonSchema>;
  title?: string;
};

export interface TriggerSchema {
  type: string;
  name: string;
  description: string;
  category: string;
  icon?: string;
  configSchema: JsonSchema;
  outputSchema: JsonSchema;
  webhookUrl?: string;
}

export interface StepSchema {
  type: string;
  name: string;
  description: string;
  category: string;
  kind: StepKind;
  icon?: string;
  configSchema: JsonSchema;
  outputSchema: JsonSchema;
}

export interface LeafCondition {
  variable: string;
  operator: string;
  value?: unknown;
}

export type Condition = LeafCondition | { all: Condition[] } | { any: Condition[] };

export interface ActionStepConfig {
  id: string;
  type: string;
  config: Record<string, unknown>;
}

export interface ConditionalStepConfig {
  id: string;
  type: 'CONDITIONAL';
  config: {
    condition: Condition;
    if_true: AutomationStepConfig[];
    if_false?: AutomationStepConfig[];
  };
}

export interface SwitchCaseEntry {
  condition: Condition;
  label?: string;
  steps: AutomationStepConfig[];
}

export interface SwitchStepConfig {
  id: string;
  type: 'SWITCH';
  config: {
    cases: SwitchCaseEntry[];
    default: AutomationStepConfig[];
  };
}

export type AutomationStepConfig = ActionStepConfig | ConditionalStepConfig | SwitchStepConfig;

export const ScheduleOffsetUnitValues = {
  minutes: 'minutes',
  hours: 'hours',
  days: 'days',
} as const;
export type ScheduleOffsetUnit =
  (typeof ScheduleOffsetUnitValues)[keyof typeof ScheduleOffsetUnitValues];

export interface ScheduleOffset {
  amount: number;
  unit: ScheduleOffsetUnit;
}

export type ScheduleConfig =
  | { type: 'IMMEDIATE' }
  | { type: 'SCHEDULED'; field: string; offset: ScheduleOffset };

export const MAX_SCHEDULE_OFFSET_MINUTES = 30 * 24 * 60;

export interface AutomationConfig {
  trigger: {
    type: string;
    config: Record<string, unknown>;
  };
  schedule?: ScheduleConfig;
  steps: AutomationStepConfig[];
}

export type ValidationIssueCode =
  | 'shape'
  | 'unknownReference'
  | 'forwardReference'
  | 'typeMismatch';

export interface ValidationIssue {
  path: string;
  code: ValidationIssueCode;
  message: string;
}

export interface ValidationResult {
  valid: boolean;
  issues: ValidationIssue[];
}

export interface Automation {
  id: string;
  name: string;
  description: string | null;
  status: AutomationStatus;
  config: AutomationConfig;
  createdById: string;
  createdAt: string;
  updatedAt: string;
  automationSeriesId: string | null;
  eventType: WorkflowEventType;
}

export interface DeskLabelRulesPayload {
  channelId: string;
  labelName: string;
  color?: string;
  labelId?: string;
  name?: string;
  emailFilters?: Record<string, unknown>;
  keepInInbox?: boolean;
}

export interface DeskLabelRulesPage {
  automations: Automation[];
  counts: {
    total: number;
    active: number;
  };
  pagination: {
    limit: number;
    nextCursor: string | null;
    hasMore: boolean;
  };
}

export function createDeskLabelRules(
  payload: DeskLabelRulesPayload,
): Promise<{ automations: Automation[]; created: boolean }> {
  return unwrap(
    apiInstance.post<SuccessEnvelope<{ automations: Automation[]; created: boolean }>>(
      '/automations/desk-label-rules',
      payload,
    ),
  );
}

export function fetchDeskLabelRules(opts: {
  channelId: string;
  cursor?: string | null;
  limit?: number;
}): Promise<DeskLabelRulesPage> {
  const params = new URLSearchParams();
  params.set('channelId', opts.channelId);
  if (opts.cursor) params.set('cursor', opts.cursor);
  if (opts.limit !== undefined) params.set('limit', String(opts.limit));
  const qs = params.toString();
  return unwrap(
    apiInstance.get<SuccessEnvelope<DeskLabelRulesPage>>(
      `/automations/desk-label-rules${qs ? `?${qs}` : ''}`,
    ),
  );
}

export function setDeskLabelRuleStatus(
  id: string,
  status: 'ACTIVE' | 'DISABLED',
): Promise<{ automation: Automation }> {
  return unwrap(
    apiInstance.patch<SuccessEnvelope<{ automation: Automation }>>(
      `/automations/desk-label-rules/${encodeURIComponent(id)}`,
      { status },
    ),
  );
}

export function archiveAutomation(
  id: string,
): Promise<{ automation?: Automation; message?: string }> {
  return unwrap(
    apiInstance.delete<SuccessEnvelope<{ automation?: Automation; message?: string }>>(
      `/automations/${encodeURIComponent(id)}`,
    ),
  );
}

/** Row shape returned by the runs list — no context blobs. */
export interface AutomationRunSummary {
  id: string;
  automationId: string;
  status: AutomationRunStatus;
  error: string | null;
  startedAt: string;
  completedAt: string | null;
}

/** Returned by the run-detail endpoint only. */
export interface AutomationRun extends AutomationRunSummary {
  triggerData: Record<string, unknown>;
  context: Record<string, unknown>;
}

export interface SaveResult {
  automation: Automation;
  validation: ValidationResult;
}

export interface ActivateResult {
  automation: Automation;
  validation: ValidationResult;
}

async function unwrap<T>(promise: Promise<{ data: SuccessEnvelope<T> }>): Promise<T> {
  const res = await promise;
  return res.data.data;
}

export function fetchOperators(): Promise<OperatorMeta[]> {
  return unwrap(apiInstance.get<SuccessEnvelope<OperatorMeta[]>>('/automations/schema/operators'));
}

export function fetchTriggerCatalog(): Promise<TriggerCatalogItem[]> {
  return unwrap(
    apiInstance.get<SuccessEnvelope<TriggerCatalogItem[]>>('/automations/schema/triggers'),
  );
}

export function fetchTriggerSchema(type: string): Promise<TriggerSchema> {
  return unwrap(
    apiInstance.get<SuccessEnvelope<TriggerSchema>>(
      `/automations/schema/triggers/${encodeURIComponent(type)}`,
    ),
  );
}

export function fetchStepCatalog(): Promise<StepCatalogItem[]> {
  return unwrap(apiInstance.get<SuccessEnvelope<StepCatalogItem[]>>('/automations/schema/steps'));
}

export function fetchStepSchema(type: string): Promise<StepSchema> {
  return unwrap(
    apiInstance.get<SuccessEnvelope<StepSchema>>(
      `/automations/schema/steps/${encodeURIComponent(type)}`,
    ),
  );
}

export function validateAutomation(config: AutomationConfig): Promise<ValidationResult> {
  return unwrap(
    apiInstance.post<SuccessEnvelope<ValidationResult>>('/automations/validate', { config }),
  );
}

// ─── Claw integration ────────────────────────────────────────────────────
export interface ClawAgent {
  id: string;
  slug: string;
  name: string;
  description: string;
  enabled: boolean;
  isDefault: boolean;
  color: string;
  spacesAppUserId?: string | null;
}

export interface AutomationWebhookInfo {
  url: string | null;
  alreadyIssued: boolean;
}

export function issueAutomationWebhook(automationId: string): Promise<AutomationWebhookInfo> {
  return unwrap(
    apiInstance.post<SuccessEnvelope<AutomationWebhookInfo>>(
      `/automations/${automationId}/webhook`,
    ),
  );
}

export function fetchClawAgents(): Promise<ClawAgent[]> {
  return unwrap(apiInstance.get<SuccessEnvelope<ClawAgent[]>>('/automations/claw/agents'));
}

export interface AutomationTemplateAttachment {
  attachmentId: string;
  originalFilename: string;
  mimetype: 'text/plain' | 'text/markdown' | 'text/html';
  size: number;
  templatePaths: string[];
}

export async function uploadAutomationTemplates(
  stepId: string,
  files: File[],
): Promise<AutomationTemplateAttachment[]> {
  const formData = new FormData();
  formData.append('stepId', stepId);
  files.forEach(file => formData.append('files', file));
  return unwrap(
    apiInstance.post<SuccessEnvelope<AutomationTemplateAttachment[]>>(
      '/automations/attachments',
      formData,
    ),
  );
}

export async function fetchAutomationTemplateContent(attachmentId: string): Promise<string> {
  const response = await apiInstance.get<Blob>(
    `/attachments/${encodeURIComponent(attachmentId)}/download`,
    { responseType: 'blob' },
  );
  return response.data.text();
}

export function releaseAutomationTemplate(attachmentId: string): Promise<{ removed: boolean }> {
  return unwrap(
    apiInstance.delete<SuccessEnvelope<{ removed: boolean }>>(
      `/automations/attachments/${encodeURIComponent(attachmentId)}`,
    ),
  );
}

// ─── Runs API (REST — replaces Zero queries for runs) ────────────────────
export interface RunsListPage {
  runs: AutomationRunSummary[];
  nextCursor: string | null;
}

export function fetchAutomationRuns(
  automationId: string,
  opts: {
    limit?: number;
    cursor?: string | null;
    status?: string | null;
    from?: number | null;
    to?: number | null;
  } = {},
): Promise<RunsListPage> {
  const params = new URLSearchParams();
  if (opts.limit !== null && opts.limit !== undefined) params.set('limit', String(opts.limit));
  if (opts.cursor) params.set('cursor', opts.cursor);
  if (opts.status) params.set('status', opts.status);
  if (opts.from !== null && opts.from !== undefined) params.set('from', String(opts.from));
  if (opts.to !== null && opts.to !== undefined) params.set('to', String(opts.to));
  const qs = params.toString();
  return unwrap(
    apiInstance.get<SuccessEnvelope<RunsListPage>>(
      `/automations/${encodeURIComponent(automationId)}/runs${qs ? `?${qs}` : ''}`,
    ),
  );
}

export interface RunDetail {
  run: AutomationRun;
  state: {
    context: string | null;
    currentStepIndex: number;
  } | null;
  steps: Array<{
    id: string;
    stepName: string | null;
    status: string | null;
    data: unknown;
    createdAt: string;
    updatedAt: string;
  }>;
}

/** Every row in this automation's lineage (all past + current versions), newest first. */
export function fetchAutomationVersions(automationId: string): Promise<Automation[]> {
  return unwrap(
    apiInstance.get<SuccessEnvelope<Automation[]>>(
      `/automations/${encodeURIComponent(automationId)}/versions`,
    ),
  );
}

export function fetchAutomationRun(executionId: string): Promise<RunDetail> {
  return unwrap(
    apiInstance.get<SuccessEnvelope<RunDetail>>(
      `/automations/runs/${encodeURIComponent(executionId)}`,
    ),
  );
}
