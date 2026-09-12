import type { Request, Response } from 'express';
import { z } from 'zod';
import { automationService } from '../services/automation.service';
import { encryptWebhookStepHeaders } from '../engine/webhook-step-encryption';
import type { AutomationConfig } from '../types/automation-config';
import { AutomationRunStatus, AutomationStatus } from '../types/status';
import { triggerTypeToEventType } from '../types/workflow-adapter';
import { WorkflowEventType } from '@xyne/shared';

/** Valid `triggerType` filter values. Unknown values are dropped, not mapped to NO_OP. */
export const WORKFLOW_EVENT_TYPE_VALUES: ReadonlySet<string> = new Set(
  Object.values(WorkflowEventType),
);

export const AutomationPayloadSchema = z.object({
  name: z.string().trim().min(1).optional(),
  description: z.string().nullable().optional(),
  config: z.custom<AutomationConfig>().optional(),
});

export const CreateAutomationPayloadSchema = AutomationPayloadSchema.extend({
  name: z.string().trim().min(1),
  config: z.custom<AutomationConfig>(),
});

export function getAuthContext(req: Request): { userId: string; workspaceId: string } | null {
  const userId = req.user?.id;
  const workspaceId = req.user?.workspaceId;
  if (!userId || !workspaceId) return null;
  return { userId, workspaceId };
}

export function sendUnauthorized(res: Response): void {
  res.status(401).json({ success: false, error: 'Unauthorized' });
}

export function prepareConfigForSave(
  config: AutomationConfig,
  res: Response,
): { config: AutomationConfig; context: string; eventType: ReturnType<typeof triggerTypeToEventType> } | null {
  const validation = automationService.validateConfig(config);
  if (!validation.valid) {
    res.status(400).json({ success: false, error: 'Invalid automation config', data: validation });
    return null;
  }

  const configToSave = JSON.parse(JSON.stringify(config)) as AutomationConfig;
  encryptWebhookStepHeaders(configToSave.steps);
  return {
    config: configToSave,
    context: JSON.stringify(configToSave),
    eventType: triggerTypeToEventType(configToSave.trigger.type),
  };
}

export function parseListLimit(raw: unknown): number {
  const parsed = typeof raw === 'string' ? Number.parseInt(raw, 10) : NaN;
  if (!Number.isFinite(parsed) || parsed <= 0) return 50;
  return Math.min(parsed, 100);
}

export const RUN_STATUS_FILTER_VALUES: ReadonlySet<string> = new Set(
  Object.values(AutomationRunStatus),
);

/** Accepted `status` filter values. */
export const AUTOMATION_STATUS_VALUES: ReadonlySet<string> = new Set(
  Object.values(AutomationStatus),
);

export function parseEpochMsParam(value: unknown): Date | null {
  if (typeof value !== 'string' || value === '') return null;
  const ms = Number.parseInt(value, 10);
  return Number.isFinite(ms) && ms > 0 ? new Date(ms) : null;
}

export function safeParseJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
}

/** Statuses the dashboard lists by default; history statuses only when named. */
export const AUTOMATION_LIVE_STATUSES: readonly AutomationStatus[] = [
  AutomationStatus.DRAFT,
  AutomationStatus.PENDING_APPROVAL,
  AutomationStatus.ACTIVE,
  AutomationStatus.DISABLED,
];

/** Repeated query params (?s=A&s=B) and comma lists (?s=A,B) both work. */
export function parseCsvList(raw: unknown): string[] {
  const parts = Array.isArray(raw) ? raw : [raw];
  const out: string[] = [];
  for (const part of parts) {
    if (typeof part !== 'string') continue;
    for (const piece of part.split(',')) {
      const trimmed = piece.trim();
      if (trimmed) out.push(trimmed);
    }
  }
  return [...new Set(out)];
}

/** Keeps only values the enum actually knows, so a typo narrows nothing silently. */
export function parseAllowedList(raw: unknown, allowed: ReadonlySet<string>): string[] {
  return parseCsvList(raw).filter(v => allowed.has(v));
}

/** Sortable fields, mapped to their Prisma column. `name` is `workflowName`. */
export const AUTOMATION_SORT_FIELDS = {
  updatedAt: 'updatedAt',
  createdAt: 'createdAt',
  name: 'workflowName',
  status: 'status',
} as const;

export type AutomationSortField = keyof typeof AUTOMATION_SORT_FIELDS;

export function parseSortField(raw: unknown): AutomationSortField {
  return typeof raw === 'string' && raw in AUTOMATION_SORT_FIELDS
    ? (raw as AutomationSortField)
    : 'updatedAt'; // matches DEFAULT_AUTOMATION_SORT in the dashboard
}

export function parseSortDirection(raw: unknown): 'asc' | 'desc' {
  return raw === 'asc' ? 'asc' : 'desc';
}

/** Sort-aware keyset cursor: carries the field it was built for. */
export function encodeAutomationListCursorFor(
  field: AutomationSortField,
  row: { id: string; createdAt: Date; updatedAt: Date; workflowName: string | null; status: string },
): string {
  const value =
    field === 'name'
      ? (row.workflowName ?? '')
      : field === 'status'
        ? row.status
        : field === 'createdAt'
          ? row.createdAt.toISOString()
          : row.updatedAt.toISOString();
  return Buffer.from(JSON.stringify({ i: row.id, f: field, v: value })).toString('base64url');
}

export function decodeAutomationListCursorFor(
  raw: unknown,
  field: AutomationSortField,
): { id: string; value: string | Date } | null {
  if (typeof raw !== 'string' || raw.length === 0) return null;
  try {
    const parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as {
      i?: unknown;
      f?: unknown;
      v?: unknown;
    };
    if (typeof parsed.i !== 'string' || typeof parsed.v !== 'string') return null;
    // A cursor from a differently-sorted page would produce nonsense rows.
    if (parsed.f !== field) return null;
    if (field === 'createdAt' || field === 'updatedAt') {
      const asDate = new Date(parsed.v);
      if (Number.isNaN(asDate.getTime())) return null;
      return { id: parsed.i, value: asDate };
    }
    return { id: parsed.i, value: parsed.v };
  } catch {
    return null;
  }
}

/**
 * DRAFT and PENDING_APPROVAL are visible only to their author; the dashboard
 * enforces this client-side only, so it is applied here as a where-clause.
 */
export function proposalVisibilityWhere(userId: string): {
  OR: Array<Record<string, unknown>>;
} {
  return {
    OR: [
      { status: { notIn: [AutomationStatus.DRAFT, AutomationStatus.PENDING_APPROVAL] } },
      { metadata: { contains: `"createdById":"${userId}"` } },
    ],
  };
}

/** Matches the same fixed metadata serialization, for a createdBy filter. */
export function createdByWhere(userIds: string[]): Array<Record<string, unknown>> {
  return userIds.map(id => ({ metadata: { contains: `"createdById":"${id}"` } }));
}

/**
 * Channel scoping lives at config.trigger.config.channelIds. `context` is text,
 * so the id is matched as a substring — a step config using it also matches.
 */
export function channelIdWhere(channelIds: string[]): Array<Record<string, unknown>> {
  return channelIds.map(id => ({ context: { contains: id } }));
}
