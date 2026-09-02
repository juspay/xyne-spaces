import { AttachmentEntityType, EmailType } from '@xyne/shared';
import { db } from '@/database/client';
import { logger } from '@/utils/logger';
import { AutomationStatus } from '../types/status';
import {
  DESK_AUTOMATION_WORKFLOW_TYPE,
  parseAutomationConfig,
  parseAutomationMetadata,
} from '../types/workflow-adapter';
import { emailReceivedTrigger } from '../triggers/email-received.trigger';
import { extractDomain } from '../triggers/email-context';
import {
  applyConversationLabel,
  archiveConversationMailbox,
  SKIPPABLE_LABEL_ERROR_CODES,
} from './conversation-label.service';

/**
 * Emails read per keyset page. Bounds both the page query and the two batched
 * derivations below, so peak memory is one page regardless of channel size.
 */
const PAGE_SIZE = 200;

export interface DeskLabelBackfillProgress {
  scanned: number;
  matched: number;
  labeled: number;
  alreadyLabeled: number;
  archived: number;
  skipped: number;
  /** The rule was disabled or archived mid-run, so the scan stopped short. */
  stoppedEarly: boolean;
}

interface ResolvedBackfillRule {
  workflowId: string;
  workspaceId: string;
  ownerId: string;
  channelId: string;
  labelId: string;
  labelName: string;
  color: string | undefined;
  keepInInbox: boolean;
  filters: Record<string, unknown>;
}

/** The email columns the matcher and the apply need — nothing else is read. */
interface ScannedEmail {
  id: string;
  conversationId: string;
  channelId: string;
  from: string;
  to: string[];
  subject: string;
  body: string;
  externalThreadId: string;
}

function emptyProgress(): DeskLabelBackfillProgress {
  return {
    scanned: 0,
    matched: 0,
    labeled: 0,
    alreadyLabeled: 0,
    archived: 0,
    skipped: 0,
    stoppedEarly: false,
  };
}

/**
 * A backfill can outlive the rule that started it — the user can disable or
 * archive it while the scan is still walking. Re-read the status between pages so
 * the run stops within one page of the change instead of labeling the whole
 * channel against the user's intent. Labels already applied stay applied; there is
 * no undo, same as the live rule.
 */
async function isRuleStillActive(workflowId: string): Promise<boolean> {
  const live = await db.workflow.findFirst({
    where: {
      id: workflowId,
      workflowType: DESK_AUTOMATION_WORKFLOW_TYPE,
      status: AutomationStatus.ACTIVE,
    },
    select: { id: true },
  });
  return live !== null;
}

/**
 * Load a desk auto-label rule in the shape the backfill needs.
 *
 * Owner / channel / label come from the reference row (the server-side index of
 * these rules); the filters and inbox behaviour come from the stored config, so a
 * replay uses exactly what the live rule uses. Returns null when the rule is gone,
 * archived, or no longer a labeling rule — the job then no-ops instead of failing.
 */
export async function resolveBackfillRule(
  workflowId: string,
): Promise<ResolvedBackfillRule | null> {
  const ref = await db.deskAutoLabelRuleReference.findFirst({
    where: {
      workflowId,
      workflow: {
        id: workflowId,
        workflowType: DESK_AUTOMATION_WORKFLOW_TYPE,
        status: AutomationStatus.ACTIVE,
      },
    },
    include: { workflow: true },
  });
  if (!ref) return null;

  const config = parseAutomationConfig(ref.workflow.context);
  const labelStep = config.steps.find(step => step.type === 'APPLY_CONVERSATION_LABEL');
  if (!labelStep) return null;

  const stepConfig = (labelStep.config ?? {}) as Record<string, unknown>;
  const labelName = typeof stepConfig['labelName'] === 'string' ? stepConfig['labelName'] : '';
  if (!labelName) return null;

  // Matches the step's own default: keepInInbox is only persisted when false.
  const keepInInbox = stepConfig['keepInInbox'] !== false;
  const color = typeof stepConfig['color'] === 'string' ? stepConfig['color'] : undefined;

  // Parity with the step, which labels as context.automation.createdById.
  const ownerId = parseAutomationMetadata(ref.workflow.metadata).createdById || ref.ownerId;

  return {
    workflowId,
    workspaceId: ref.workspaceId,
    ownerId,
    channelId: ref.channelId,
    labelId: ref.labelId,
    labelName,
    color,
    keepInInbox,
    filters: (config.trigger.config ?? {}) as Record<string, unknown>,
  };
}

/**
 * Earliest email per thread, batched.
 *
 * Mirrors emailRepository.findFirstByThreadAndChannel — same (externalThreadId,
 * channelId) predicate, same createdAt-ascending pick, no type filter — so the
 * isReply this produces is the one the live trigger would have produced for the
 * same row. Only called when the rule actually uses onlyNewThreads / onlyReplies.
 */
async function loadThreadRoots(
  channelId: string,
  emails: readonly ScannedEmail[],
): Promise<Map<string, string>> {
  const threadIds = [...new Set(emails.map(e => e.externalThreadId).filter(Boolean))];
  const rootByThread = new Map<string, string>();
  if (threadIds.length === 0) return rootByThread;

  const rows = await db.email.findMany({
    where: { channelId, externalThreadId: { in: threadIds } },
    orderBy: { createdAt: 'asc' },
    select: { id: true, externalThreadId: true },
  });
  for (const row of rows) {
    if (!rootByThread.has(row.externalThreadId)) {
      rootByThread.set(row.externalThreadId, row.id);
    }
  }
  return rootByThread;
}

/** Email ids in this page that carry a live attachment. Only called when the rule filters on it. */
async function loadEmailIdsWithAttachments(
  emails: readonly ScannedEmail[],
): Promise<Set<string>> {
  const emailIds = emails.map(e => e.id);
  if (emailIds.length === 0) return new Set();

  const rows = await db.messageAttachment.findMany({
    where: {
      entityId: { in: emailIds },
      entityType: AttachmentEntityType.EMAIL,
      isDeleted: false,
    },
    select: { entityId: true },
  });
  return new Set(rows.map(row => row.entityId));
}

/**
 * Conversations from `conversationIds` that do NOT already carry THIS rule's label.
 *
 * Scoped to the one labelId on purpose: labels are additive, so a thread already
 * carrying other labels still needs this one. Purely an optimisation to avoid no-op
 * writes — applyConversationLabel is idempotent on (conversationId, labelId) and
 * would return alreadyPresent anyway.
 */
async function filterAlreadyLabeled(
  labelId: string,
  conversationIds: readonly string[],
): Promise<{ pending: string[]; alreadyLabeled: number }> {
  if (conversationIds.length === 0) return { pending: [], alreadyLabeled: 0 };

  const existing = await db.conversationLabelMapping.findMany({
    where: { labelId, conversationId: { in: [...conversationIds] } },
    select: { conversationId: true },
  });
  const labeled = new Set(existing.map(row => row.conversationId));
  return {
    pending: conversationIds.filter(id => !labeled.has(id)),
    alreadyLabeled: labeled.size,
  };
}

/**
 * Replay one desk auto-label rule over the mail already in its channel.
 *
 * Walks the channel's inbound emails by keyset (id ascending, one page at a time)
 * so a large desk never lands in memory at once, matches each row with the live
 * trigger's own matcher, and applies the label one thread at a time to keep DB load
 * flat. Every apply is idempotent, so a retried run re-does work rather than
 * corrupting it. Per-item failures are logged and skipped — one bad thread must not
 * abort the rest of the backfill.
 */
export async function runDeskLabelBackfill(
  rule: ResolvedBackfillRule,
  onProgress?: (progress: DeskLabelBackfillProgress) => void,
): Promise<DeskLabelBackfillProgress> {
  const progress = emptyProgress();
  const needsIsReply = rule.filters['onlyNewThreads'] === true || rule.filters['onlyReplies'] === true;
  const needsAttachments = rule.filters['hasAttachments'] === true;

  let lastId: string | undefined;
  let hasMore = true;
  let firstPage = true;

  while (hasMore) {
    // Skipped on the first page — the worker just resolved the rule.
    if (!firstPage && !(await isRuleStillActive(rule.workflowId))) {
      progress.stoppedEarly = true;
      logger.info(
        `[desk-label-backfill] automation=${rule.workflowId} no longer active — stopping after ${progress.scanned} scanned`,
      );
      break;
    }
    firstPage = false;

    const emails: ScannedEmail[] = await db.email.findMany({
      where: {
        channelId: rule.channelId,
        // The live emitter drops everything that is not inbound mail
        // (emitEmailReceived), so a replay has to drop it too.
        type: EmailType.DEFAULT,
        ...(lastId ? { id: { gt: lastId } } : {}),
      },
      select: {
        id: true,
        conversationId: true,
        channelId: true,
        from: true,
        to: true,
        subject: true,
        body: true,
        externalThreadId: true,
      },
      orderBy: { id: 'asc' },
      take: PAGE_SIZE,
    });
    if (emails.length === 0) break;

    progress.scanned += emails.length;
    lastId = emails[emails.length - 1]?.id;
    hasMore = emails.length === PAGE_SIZE;

    const [rootByThread, withAttachments] = await Promise.all([
      needsIsReply ? loadThreadRoots(rule.channelId, emails) : Promise.resolve(null),
      needsAttachments ? loadEmailIdsWithAttachments(emails) : Promise.resolve(null),
    ]);

    // The label lands on the conversation, so N matching emails in one thread
    // collapse to a single apply.
    const seen = new Set<string>();
    const conversationIds: string[] = [];
    for (const email of emails) {
      const root = rootByThread && email.externalThreadId
        ? rootByThread.get(email.externalThreadId)
        : undefined;
      const payload = {
        email: {
          channelId: email.channelId,
          from: email.from,
          to: email.to,
          subject: email.subject,
          body: email.body,
          hasAttachments: withAttachments ? withAttachments.has(email.id) : false,
        },
        fromDomain: extractDomain(email.from),
        isReply: root !== undefined && root !== email.id,
      };

      if (!emailReceivedTrigger.matchFilters(rule.filters, payload)) continue;
      progress.matched += 1;
      if (seen.has(email.conversationId)) continue;
      seen.add(email.conversationId);
      conversationIds.push(email.conversationId);
    }

    const { pending, alreadyLabeled } = await filterAlreadyLabeled(rule.labelId, conversationIds);
    progress.alreadyLabeled += alreadyLabeled;

    for (const conversationId of pending) {
      try {
        const applied = await db.$transaction(async tx => {
          const result = await applyConversationLabel(
            {
              conversationId,
              channelId: rule.channelId,
              labelName: rule.labelName,
              createdById: rule.ownerId,
              color: rule.color,
              labelId: rule.labelId,
            },
            tx,
          );
          if (!rule.keepInInbox) {
            await archiveConversationMailbox(
              {
                conversationId,
                channelId: rule.channelId,
                workspaceId: rule.workspaceId,
                userId: rule.ownerId,
              },
              tx,
            );
          }
          return result;
        });

        if (applied.applied) progress.labeled += 1;
        else progress.alreadyLabeled += 1;
        if (!rule.keepInInbox) progress.archived += 1;
      } catch (err) {
        progress.skipped += 1;
        const code = (err as { code?: string } | null)?.code;
        if (code && SKIPPABLE_LABEL_ERROR_CODES.has(code)) {
          logger.debug?.(
            `[desk-label-backfill] skipped conversation=${conversationId} reason=${code}`,
          );
          continue;
        }
        logger.error(
          `[desk-label-backfill] apply failed automation=${rule.workflowId} conversation=${conversationId}:`,
          err,
        );
      }
    }

    onProgress?.({ ...progress });
  }

  return progress;
}
