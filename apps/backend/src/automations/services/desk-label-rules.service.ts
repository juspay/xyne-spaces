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
  buildAutomationMetadata,
  triggerTypeToEventType,
  workflowToAutomation,
  type AutomationView,
} from '../types/workflow-adapter';
import { automationService } from './automation.service';
import {
  deskLabelBackfillQueue,
  type DeskLabelBackfillRun,
  type EnqueueBackfillResult,
} from '../queue/desk-label-backfill.queue';

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

export interface DeskLabelRulesCreateResult {
  automations: AutomationView[];
  created: boolean;
  /** Set only when the caller asked to replay the rule over existing mail. */
  backfill: EnqueueBackfillResult | null;
}

type DeskRulesDbClient = typeof db | Prisma.TransactionClient;

interface DeskRuleCursor {
  id: string;
  createdAt: Date;
}

interface ResolvedConversationLabel {
  id: string;
  name: string;
  color: string | null;
}

function serviceError(message: string, code: 'not-found' | 'forbidden' | 'invalid'): Error {
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

function workflowToSingleResult(workflow: Workflow, created: boolean): DeskLabelRulesCreateResult {
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

class DeskLabelRulesService {
  private buildValidatedRuleConfig(params: {
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
    const workflowId = result.automations[0]?.id;
    if (!workflowId) return result;
    return { ...result, backfill: await this.enqueueBackfill(workflowId) };
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
      return await db.$transaction(async tx => {
        const label = await this.resolveOrCreateLabel(tx, payload, auth);
        const config = this.buildValidatedRuleConfig({
          channelId: payload.channelId,
          emailFilters,
          label,
          keepInInbox: payload.keepInInbox,
        });

        const existing = await this.findOrRestoreExistingDeskWorkflow(tx, {
          auth,
          channelId: payload.channelId,
          label,
          filterFingerprint,
          name,
          config,
        });
        if (existing) {
          return workflowToSingleResult(existing, false);
        }

        const id = uuidv4();
        const workflow = await tx.workflow.create({
          data: {
            id,
            workflowType: DESK_AUTOMATION_WORKFLOW_TYPE,
            workflowName: name,
            workspaceId: auth.workspaceId,
            status: AutomationStatus.ACTIVE,
            eventType: triggerTypeToEventType(config.trigger.type),
            automationSeriesId: id,
            context: JSON.stringify(config),
            metadata: buildAutomationMetadata({
              description: `Desk auto-label for incoming email -> ${label.name}`,
              createdById: auth.userId,
            }),
          },
        });

        await tx.deskAutoLabelRuleReference.create({
          data: {
            workflowId: workflow.id,
            labelId: label.id,
            workspaceId: auth.workspaceId,
            ownerId: auth.userId,
            channelId: payload.channelId,
            filterFingerprint,
            createdAt: new Date(),
          },
        });

        logger.info(
          `[automations] desk-label-rule created user=${auth.userId} channel=${payload.channelId} label=${label.id}`,
        );
        return workflowToSingleResult(workflow, true);
      });
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
        const existing = await db.$transaction(tx =>
          this.findOrRestoreExistingDeskWorkflow(tx, {
            auth,
            channelId: payload.channelId,
            label,
            filterFingerprint,
            name,
            config,
          }),
        );
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

  private async findOrRestoreExistingDeskWorkflow(
    tx: Prisma.TransactionClient,
    params: {
      auth: { userId: string; workspaceId: string };
      channelId: string;
      label: ResolvedConversationLabel;
      filterFingerprint: string;
      name: string;
      config: AutomationConfig;
    },
  ): Promise<Workflow | null> {
    const duplicate = await this.findExistingDeskWorkflow(tx, {
      workspaceId: params.auth.workspaceId,
      ownerId: params.auth.userId,
      channelId: params.channelId,
      labelId: params.label.id,
      filterFingerprint: params.filterFingerprint,
      statuses: [AutomationStatus.ACTIVE, AutomationStatus.DISABLED],
    });
    if (duplicate) {
      return duplicate;
    }

    const archivedDuplicate = await this.findExistingDeskWorkflow(tx, {
      workspaceId: params.auth.workspaceId,
      ownerId: params.auth.userId,
      channelId: params.channelId,
      labelId: params.label.id,
      filterFingerprint: params.filterFingerprint,
      statuses: [AutomationStatus.ARCHIVED],
    });
    if (!archivedDuplicate) {
      return null;
    }

    return this.restoreArchivedDeskWorkflow(tx, archivedDuplicate, params);
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
    return db.$transaction(async tx => {
      const workflow = await this.requireOwnedDeskRule(tx, automationId, auth);
      const archived = await tx.workflow.update({
        where: { id: workflow.id },
        data: {
          status: AutomationStatus.ARCHIVED,
          updatedAt: new Date(),
        },
      });
      return workflowToAutomation(archived);
    });
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

  private async resolveOrCreateLabel(
    tx: Prisma.TransactionClient,
    payload: DeskLabelRulesPayload,
    auth: { userId: string; workspaceId: string },
  ): Promise<ResolvedConversationLabel> {
    const labelName = payload.labelName.trim();
    const labelId = payload.labelId?.trim();
    const now = new Date();

    if (labelId) {
      const label = await tx.conversationLabel.findUnique({
        where: { id: labelId },
        select: {
          id: true,
          name: true,
          color: true,
          channelId: true,
          workspaceId: true,
          createdBy: true,
        },
      });
      if (!label || label.workspaceId !== auth.workspaceId || label.channelId !== payload.channelId) {
        throw serviceError('Label not found', 'not-found');
      }
      if (label.createdBy !== auth.userId) {
        throw serviceError('Label does not belong to the current user.', 'forbidden');
      }
      if (label.name !== labelName) {
        throw serviceError('Label id does not match the requested label name.', 'invalid');
      }
      return { id: label.id, name: label.name, color: label.color };
    }

    const channel = await tx.channel.findFirst({
      where: { id: payload.channelId, workspaceId: auth.workspaceId },
      select: { projectId: true, workspaceId: true },
    });
    if (!channel) {
      throw serviceError('Channel not found', 'not-found');
    }

    const label = await tx.conversationLabel.upsert({
      where: {
        channelId_createdBy_name: {
          channelId: payload.channelId,
          createdBy: auth.userId,
          name: labelName,
        },
      },
      create: {
        id: uuidv4(),
        name: labelName,
        ...(payload.color ? { color: payload.color } : {}),
        channelId: payload.channelId,
        projectId: channel.projectId,
        workspaceId: channel.workspaceId,
        createdBy: auth.userId,
        createdAt: now,
        updatedAt: now,
      },
      update: { updatedAt: now },
      select: { id: true, name: true, color: true },
    });

    return label;
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

  private async findExistingDeskWorkflow(
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

  private async restoreArchivedDeskWorkflow(
    tx: Prisma.TransactionClient,
    workflow: Workflow,
    params: {
      name: string;
      config: AutomationConfig;
      auth: { userId: string; workspaceId: string };
      label: ResolvedConversationLabel;
      channelId: string;
      filterFingerprint: string;
    },
  ): Promise<Workflow> {
    try {
      const restored = await tx.workflow.update({
        where: {
          id: workflow.id,
          status: AutomationStatus.ARCHIVED,
        },
        data: {
          workflowName: params.name,
          status: AutomationStatus.ACTIVE,
          eventType: triggerTypeToEventType(params.config.trigger.type),
          context: JSON.stringify(params.config),
          metadata: buildAutomationMetadata({
            description: `Desk auto-label for incoming email -> ${params.label.name}`,
            createdById: params.auth.userId,
          }),
          updatedAt: new Date(),
        },
      });
      logger.info(
        `[automations] desk-label-rule restored user=${params.auth.userId} channel=${params.channelId} label=${params.label.id}`,
      );
      return restored;
    } catch (err) {
      if (!(err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025')) {
        throw err;
      }
    }

    const activeDuplicate = await this.findExistingDeskWorkflow(tx, {
      workspaceId: params.auth.workspaceId,
      ownerId: params.auth.userId,
      channelId: params.channelId,
      labelId: params.label.id,
      filterFingerprint: params.filterFingerprint,
      statuses: [AutomationStatus.ACTIVE, AutomationStatus.DISABLED],
    });
    if (!activeDuplicate) {
      throw serviceError('Automation not found', 'not-found');
    }
    return activeDuplicate;
  }

  private async requireOwnedDeskRule(
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
