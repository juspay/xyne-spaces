import { createRuleTx } from '@/bypassAcl/transactions/deskLabelRulesService';
import { createHash } from 'crypto';
import { Prisma, type Workflow } from '@prisma/client';
import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';
import { db } from '@/database/client';
import { logger } from '@/utils/logger';
import { repositories } from '@/database/repositories';
import { AutomationStatus } from '../types/status';
import type { AutomationConfig } from '../types/automation-config';
import {
  EmailReceivedConfigFieldsSchema,
  hasEmailReceivedFilterConstraints,
  withEmailReceivedConfigValidation,
} from '../triggers/email-received.trigger';
import {
  DESK_AUTOMATION_WORKFLOW_TYPE,
  
  
  workflowToAutomation,
  type AutomationView,
} from '../types/workflow-adapter';
import { automationService } from './automation.service';
import {
  deskLabelBackfillQueue,
  type DeskLabelBackfillRun,
  type EnqueueBackfillResult,
} from '../queue/desk-label-backfill.queue';
import { createRuleTx2 } from '@/bypassAcl/transactions/deskLabelRulesService';
import { archivePersonalTx } from '@/bypassAcl/transactions/deskLabelRulesService';

export const DeskLabelRulesPayloadSchema = z.object({
  channelId: z.string().min(1),
  labelName: z.string().trim().min(1),
  color: z.string().optional(),
  labelId: z.string().optional(),
  name: z.string().trim().min(1).optional(),
  emailFilters: withEmailReceivedConfigValidation(
    EmailReceivedConfigFieldsSchema.omit({ channelIds: true }),
  ).optional(),
  keepInInbox: z.boolean().optional(),
  /** Also replay the rule over mail already in this desk. Off unless asked for. */
  applyToExisting: z.boolean().optional(),
});

export type DeskLabelRulesPayload = z.infer<typeof DeskLabelRulesPayloadSchema>;

export interface DeskLabelRulesPage {
  automations: AutomationView[];
  counts: {
    total: number;
    active: number;
  };
  pagination: {
    limit: number;
    nextCursor: { id: string; createdAt: Date } | null;
    hasMore: boolean;
  };
}

export type DeskLabelBackfillOutcome = EnqueueBackfillResult | 'inactive';

export interface DeskLabelRulesCreateResult {
  automations: AutomationView[];
  created: boolean;
  /** Set only when the caller asked to replay the rule over existing mail. */
  backfill: DeskLabelBackfillOutcome | null;
}

type DeskRulesDbClient = typeof db | Prisma.TransactionClient;

interface DeskRuleCursor {
  id: string;
  createdAt: Date;
}

export interface ResolvedConversationLabel {
  id: string;
  name: string;
  color: string | null;
}

export function serviceError(message: string, code: 'not-found' | 'forbidden' | 'invalid'): Error {
  return Object.assign(new Error(message), { code });
}

function applyLabelStepConfig(params: {
  conversationIdVar: string;
  channelId: string;
  labelName: string;
  color?: string | null | undefined;
  labelId: string;
  keepInInbox?: boolean | undefined;
}): Record<string, unknown> {
  return {
    conversationId: params.conversationIdVar,
    channelId: params.channelId,
    labelName: params.labelName,
    ...(params.color ? { color: params.color } : {}),
    labelId: params.labelId,
    ...(params.keepInInbox === false ? { keepInInbox: false } : {}),
  };
}

function buildApplyLabelStep(params: {
  conversationIdVar: string;
  channelId: string;
  labelName: string;
  color?: string | null | undefined;
  labelId: string;
  keepInInbox?: boolean | undefined;
}): AutomationConfig['steps'][number] {
  return {
    id: uuidv4(),
    type: 'APPLY_CONVERSATION_LABEL',
    config: applyLabelStepConfig(params),
  };
}

function buildRuleConfig(params: {
  channelId: string;
  emailFilters: Record<string, unknown>;
  label: ResolvedConversationLabel;
  keepInInbox?: boolean | undefined;
}): AutomationConfig {
  return {
    trigger: {
      type: 'EMAIL_RECEIVED',
      config: {
        ...params.emailFilters,
        channelIds: [params.channelId],
      },
    },
    steps: [
      buildApplyLabelStep({
        conversationIdVar: '{{context.trigger.email.conversationId}}',
        channelId: params.channelId,
        labelName: params.label.name,
        color: params.label.color,
        labelId: params.label.id,
        keepInInbox: params.keepInInbox,
      }),
    ],
  };
}

function ensureConfigValid(config: AutomationConfig): void {
  const validation = automationService.validateConfig(config);
  if (!validation.valid) {
    const summary = validation.issues
      .slice(0, 3)
      .map(i => `${i.path}: ${i.message}`)
      .join('; ');
    throw Object.assign(new Error(`Invalid automation config: ${summary}`), {
      code: 'invalid' as const,
      validation,
    });
  }
}

export function workflowToSingleResult(workflow: Workflow, created: boolean): DeskLabelRulesCreateResult {
  return { automations: [workflowToAutomation(workflow)], created, backfill: null };
}

function workflowStatusIn(statuses: AutomationStatus[]): Prisma.StringFilter | string {
  return statuses.length === 1 ? statuses[0] : { in: statuses };
}

function isUniqueConflict(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
}

function normalizedStrings(
  value: unknown,
  normalize: (value: string) => string,
): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const normalized = value
    .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    .map(normalize);
  if (normalized.length === 0) return undefined;
  return [...new Set(normalized)].sort((a, b) => a.localeCompare(b));
}

function canonicalizeEmailReceivedFilters(
  filters: Record<string, unknown>,
): Record<string, unknown> {
  const canonical: Record<string, unknown> = {};
  const lower = (value: string): string => value.toLowerCase();
  const domain = (value: string): string => value.replace(/^@/, '').toLowerCase();
  const matchCase = filters['matchCase'] === true;
  const text = (value: string): string => (matchCase ? value : value.toLowerCase());

  const arrays: Array<[string, (value: string) => string]> = [
    ['fromEmails', lower],
    ['fromDomains', domain],
    ['toEmails', lower],
    ['subjectContains', text],
    ['bodyContains', text],
    ['excludedFromEmails', lower],
    ['excludedFromDomains', domain],
    ['excludedToEmails', lower],
    ['excludedSubjectContains', text],
    ['excludedBodyContains', text],
  ];

  for (const [key, normalize] of arrays) {
    const value = normalizedStrings(filters[key], normalize);
    if (value) canonical[key] = value;
  }

  const hasTextFilters = [
    'subjectContains',
    'bodyContains',
    'excludedSubjectContains',
    'excludedBodyContains',
  ].some(key => canonical[key] !== undefined);
  if (matchCase && hasTextFilters) canonical['matchCase'] = true;

  for (const key of ['hasAttachments', 'onlyNewThreads', 'onlyReplies'] as const) {
    if (filters[key] === true) canonical[key] = true;
  }

  return canonical;
}

function fingerprintEmailReceivedFilters(filters: Record<string, unknown>): string {
  const canonical = canonicalizeEmailReceivedFilters(filters);
  const digest = createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
  return `email-received:v1:${digest}`;
}

export class DeskLabelRulesService {
  buildValidatedRuleConfig(params: {
    channelId: string;
    emailFilters: Record<string, unknown>;
    label: ResolvedConversationLabel;
    keepInInbox?: boolean | undefined;
  }): AutomationConfig {
    const config = buildRuleConfig(params);
    ensureConfigValid(config);
    return config;
  }

  async create(
    payload: DeskLabelRulesPayload,
    auth: { userId: string; workspaceId: string },
  ): Promise<DeskLabelRulesCreateResult> {
    const result = await this.createRule(payload, auth);
    if (!payload.applyToExisting) return result;

    // Enqueued after the rule is committed — the worker reads the rule back from
    // the DB, so a job started inside the transaction could find nothing there.
    // A duplicate rule still backfills: "apply this rule to my old mail" is a
    // valid ask even when the rule itself already existed.
    const rule = result.automations[0];
    if (!rule) return result;
    if (rule.status !== AutomationStatus.ACTIVE) {
      logger.info(
        `[automations] desk-label-rule backfill skipped automation=${rule.id} status=${rule.status}`,
      );
      return { ...result, backfill: 'inactive' };
    }

    return { ...result, backfill: await this.enqueueBackfill(rule.id) };
  }

  private async createRule(
    payload: DeskLabelRulesPayload,
    auth: { userId: string; workspaceId: string },
  ): Promise<DeskLabelRulesCreateResult> {
    await this.requireDeskChannel(payload.channelId, auth);

    if (!hasEmailReceivedFilterConstraints(payload.emailFilters)) {
      throw serviceError('Add at least one email filter before saving.', 'invalid');
    }

    const emailFilters = (payload.emailFilters ?? {}) as Record<string, unknown>;
    const filterFingerprint = fingerprintEmailReceivedFilters(emailFilters);
    const name = payload.name?.trim() || `Auto-label: ${payload.labelName}`;

    try {
      return await createRuleTx(this, payload, auth, emailFilters, filterFingerprint, name);
    } catch (err) {
      if (!isUniqueConflict(err)) throw err;

      const label = await this.findExistingLabelForDuplicate(payload, auth);
      if (label) {
        const config = this.buildValidatedRuleConfig({
          channelId: payload.channelId,
          emailFilters,
          label,
          keepInInbox: payload.keepInInbox,
        });
        const existing = await createRuleTx2(this, auth, payload, label, filterFingerprint, name, config);
        if (existing) {
          logger.info(
            `[automations] desk-label-rule duplicate user=${auth.userId} channel=${payload.channelId} label=${label.id}`,
          );
          return workflowToSingleResult(existing, false);
        }
      }
      throw err;
    }
  }

  async listOwned(
    auth: { userId: string; workspaceId: string },
    channelId: string,
    opts: { limit: number; cursor: DeskRuleCursor | null },
  ): Promise<DeskLabelRulesPage> {
    await this.requireDeskChannel(channelId, auth);

    const baseWhere: Prisma.DeskAutoLabelRuleReferenceWhereInput = {
      workspaceId: auth.workspaceId,
      ownerId: auth.userId,
      channelId,
      workflow: {
        workspaceId: auth.workspaceId,
        workflowType: DESK_AUTOMATION_WORKFLOW_TYPE,
        status: { in: [AutomationStatus.ACTIVE, AutomationStatus.DISABLED] },
      },
    };
    const cursorWhere: Prisma.DeskAutoLabelRuleReferenceWhereInput =
      opts.cursor
        ? {
            OR: [
              { createdAt: { lt: opts.cursor.createdAt } },
              { createdAt: opts.cursor.createdAt, id: { lt: opts.cursor.id } },
            ],
          }
        : {};

    const [rows, total, active] = await Promise.all([
      db.deskAutoLabelRuleReference.findMany({
        where: { AND: [baseWhere, cursorWhere] },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: opts.limit + 1,
        include: { workflow: true },
      }),
      db.deskAutoLabelRuleReference.count({ where: baseWhere }),
      db.deskAutoLabelRuleReference.count({
        where: {
          ...baseWhere,
          workflow: {
            workspaceId: auth.workspaceId,
            workflowType: DESK_AUTOMATION_WORKFLOW_TYPE,
            status: AutomationStatus.ACTIVE,
          },
        },
      }),
    ]);

    const hasMore = rows.length > opts.limit;
    const page = hasMore ? rows.slice(0, opts.limit) : rows;
    const last = page[page.length - 1] ?? null;

    return {
      automations: page.map(row => workflowToAutomation(row.workflow)),
      counts: { total, active },
      pagination: {
        limit: opts.limit,
        nextCursor: hasMore && last ? { id: last.id, createdAt: last.createdAt } : null,
        hasMore,
      },
    };
  }

  async setStatus(
    automationId: string,
    nextStatus: AutomationStatus.ACTIVE | AutomationStatus.DISABLED,
    auth: { userId: string; workspaceId: string },
  ): Promise<AutomationView> {
    await this.requireOwnedDeskRule(db, automationId, auth);
    const updated = await db.workflow.update({
      where: { id: automationId },
      data: { status: nextStatus, updatedAt: new Date() },
    });
    return workflowToAutomation(updated);
  }

  /** Replay an existing rule over the mail already in its desk. */
  async startBackfill(
    automationId: string,
    auth: { userId: string; workspaceId: string },
  ): Promise<EnqueueBackfillResult | null> {
    const workflow = await this.requireOwnedDeskRule(db, automationId, auth);
    if (workflow.status !== AutomationStatus.ACTIVE) {
      throw serviceError('Activate the rule before applying it to existing emails.', 'invalid');
    }
    return this.enqueueBackfill(workflow.id);
  }

  async getBackfillStatus(
    automationId: string,
    auth: { userId: string; workspaceId: string },
  ): Promise<DeskLabelBackfillRun | null> {
    await this.requireOwnedDeskRule(db, automationId, auth);
    if (!deskLabelBackfillQueue.isReady) return null;
    return deskLabelBackfillQueue.getRun(automationId);
  }

  /**
   * A backfill is a convenience pass over history, never part of the rule being
   * saved — so a queue that is down must not fail rule creation.
   */
  private async enqueueBackfill(workflowId: string): Promise<EnqueueBackfillResult | null> {
    try {
      await deskLabelBackfillQueue.initialize();
      return await deskLabelBackfillQueue.enqueue(workflowId);
    } catch (err) {
      logger.error(
        `[automations] desk-label-rule backfill enqueue failed automation=${workflowId}:`,
        err,
      );
      return null;
    }
  }

  async archivePersonal(
    automationId: string,
    auth: { userId: string; workspaceId: string },
  ): Promise<AutomationView> {
    return archivePersonalTx(this, automationId, auth);
  }

  private async requireDeskChannel(
    channelId: string,
    auth: { userId: string; workspaceId: string },
  ): Promise<void> {
    const channel = await db.channel.findFirst({
      where: { id: channelId, workspaceId: auth.workspaceId },
      select: { id: true },
    });
    if (!channel) {
      throw serviceError('Channel not found', 'not-found');
    }

    const isParticipant = await repositories.channelParticipants.isParticipant(
      channelId,
      auth.userId,
    );
    if (!isParticipant) {
      throw serviceError('You must be a member of this desk channel.', 'forbidden');
    }
  }

  private async findExistingLabelForDuplicate(
    payload: DeskLabelRulesPayload,
    auth: { userId: string; workspaceId: string },
  ): Promise<ResolvedConversationLabel | null> {
    if (payload.labelId?.trim()) {
      return db.conversationLabel.findFirst({
        where: {
          id: payload.labelId.trim(),
          workspaceId: auth.workspaceId,
          channelId: payload.channelId,
          createdBy: auth.userId,
        },
        select: { id: true, name: true, color: true },
      });
    }
    return db.conversationLabel.findFirst({
      where: {
        workspaceId: auth.workspaceId,
        channelId: payload.channelId,
        createdBy: auth.userId,
        name: payload.labelName.trim(),
      },
      select: { id: true, name: true, color: true },
    });
  }

  async findExistingDeskWorkflow(
    client: DeskRulesDbClient,
    params: {
      workspaceId: string;
      ownerId: string;
      channelId: string;
      labelId: string;
      filterFingerprint: string;
      statuses: AutomationStatus[];
    },
  ): Promise<Workflow | null> {
    const ref = await client.deskAutoLabelRuleReference.findFirst({
      where: {
        workspaceId: params.workspaceId,
        ownerId: params.ownerId,
        channelId: params.channelId,
        labelId: params.labelId,
        filterFingerprint: params.filterFingerprint,
        workflow: {
          workspaceId: params.workspaceId,
          workflowType: DESK_AUTOMATION_WORKFLOW_TYPE,
          status: workflowStatusIn(params.statuses),
        },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      include: { workflow: true },
    });
    return ref?.workflow ?? null;
  }

  async requireOwnedDeskRule(
    client: DeskRulesDbClient,
    automationId: string,
    auth: { userId: string; workspaceId: string },
  ): Promise<Workflow> {
    const ref = await client.deskAutoLabelRuleReference.findFirst({
      where: {
        workflowId: automationId,
        workspaceId: auth.workspaceId,
        ownerId: auth.userId,
        workflow: {
          id: automationId,
          workspaceId: auth.workspaceId,
          workflowType: DESK_AUTOMATION_WORKFLOW_TYPE,
          status: { not: AutomationStatus.ARCHIVED },
        },
      },
      include: { workflow: true },
    });
    if (!ref) {
      throw serviceError('Automation not found', 'not-found');
    }
    return ref.workflow;
  }
}

export const deskLabelRulesService = new DeskLabelRulesService();
