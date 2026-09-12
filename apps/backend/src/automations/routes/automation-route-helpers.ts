import type { Request, Response } from 'express';
import { z } from 'zod';
import { automationService } from '../services/automation.service';
import { encryptWebhookStepHeaders } from '../engine/webhook-step-encryption';
import type { AutomationConfig } from '../types/automation-config';
import { AutomationRunStatus, AutomationStatus } from '../types/status';
import { triggerTypeToEventType } from '../types/workflow-adapter';
import { WorkflowEventType } from '@xyne/shared';

/**
 * Valid `triggerType` filter values. Validated against the real enum rather
 * than run through triggerTypeToEventType, which maps anything unknown to
 * NO_OP — a typo would otherwise silently filter to "Manual / Other" instead
 * of reporting nothing matched.
 */
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

export function encodeAutomationListCursor(row: { id: string; createdAt: Date }): string {
  return Buffer.from(JSON.stringify({ id: row.id, createdAt: row.createdAt.toISOString() })).toString('base64url');
}

export function decodeAutomationListCursor(raw: unknown): { id: string; createdAt: Date } | null {
  if (typeof raw !== 'string' || raw.length === 0) return null;
  try {
    const parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as {
      id?: unknown;
      createdAt?: unknown;
    };
    if (typeof parsed.id !== 'string' || typeof parsed.createdAt !== 'string') return null;
    const createdAt = new Date(parsed.createdAt);
    if (Number.isNaN(createdAt.getTime())) return null;
    return { id: parsed.id, createdAt };
  } catch {
    return null;
  }
}

export const RUN_STATUS_FILTER_VALUES: ReadonlySet<string> = new Set(
  Object.values(AutomationRunStatus),
);

/** Accepted `status` values when filtering the automation list. Derived from
 *  the enum so a new status is filterable the moment it is added. */
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

/**
 * Statuses the dashboard shows by default (AutomationFiltersBar/filters.ts).
 * ARCHIVED / REJECTED / REVOKED / AUTO_REVOKED are lineage history and stay out
 * of the list unless asked for by name, so the claw list matches what a person
 * sees in the UI rather than inventing its own default.
 */
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

/**
 * Sort-aware keyset cursor.
 *
 * The old cursor hardcoded `createdAt`, so paging under any other sort silently
 * walked the wrong column. This carries the field it was built for and is
 * rejected on decode if the caller then changes sort mid-pagination.
 */
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
 * DRAFT and PENDING_APPROVAL rows belong to their author alone; every other
 * status is visible workspace-wide. The dashboard enforces this in
 * `isVisibleToUser`, but it is CLIENT-SIDE ONLY — neither the REST list nor the
 * Zero `WorkflowsACL` applies it, so a filtered API call could otherwise read
 * (or enumerate, via createdBy) another user's private drafts. Applied here as
 * a where-clause so no filter combination can escape it.
 *
 * createdById lives inside the `metadata` JSON string, written by
 * buildAutomationMetadata as {"description":...,"createdById":"..."} — matching
 * the quoted key/value pair, not a bare id, keeps it from matching a
 * description that happens to contain the id.
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
 * Channel scoping lives at config.trigger.config.channelIds (an ARRAY — the
 * dashboard's getAutomationChannelIds reads the same path). `context` is a text
 * column holding the config JSON, so this matches the id as a substring.
 * Channel ids are cuids, so a false positive would need the id to appear
 * elsewhere in the same config — possible via a step config, and deliberately
 * accepted here to keep the query expressible in plain Prisma.
 */
export function channelIdWhere(channelIds: string[]): Array<Record<string, unknown>> {
  return channelIds.map(id => ({ context: { contains: id } }));
}
