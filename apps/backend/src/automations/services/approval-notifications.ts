import { repositories } from '@/database/repositories';
import { AccessType, MessageType } from '@xyne/shared';
import { logger } from '@/utils/logger';
import { conversationService } from '@/services/conversationService';
import { runAsServiceActor } from '@/database/tenant/context';
import { unifiedBotUserService } from '@/bots/unified/services/unified-bot-user-service';
import { config } from '@/config/env';
import type { AutomationView } from '../types/workflow-adapter';

const AUTOMATIONS_BOT_ID = 'automations';
const AUTOMATIONS_RESOURCE_NAME = 'AUTOMATIONS';

const cachedBotUserIdByWorkspace = new Map<string, string>();
async function getApprovalBotUserId(workspaceId: string): Promise<string | null> {
  const cached = cachedBotUserIdByWorkspace.get(workspaceId);
  if (cached) return cached;
  try {
    const bot = await unifiedBotUserService.getBotByBotId(AUTOMATIONS_BOT_ID, workspaceId);
    if (!bot) {
      logger.warn(
        `[approval-notifications] bot "${AUTOMATIONS_BOT_ID}" not registered for workspace ${workspaceId}; skipping DM`,
      );
      return null;
    }
    cachedBotUserIdByWorkspace.set(workspaceId, bot.id);
    return bot.id;
  } catch (err) {
    logger.warn('[approval-notifications] failed to look up bot user', err);
    return null;
  }
}

async function listAutomationsAdminUserIds(): Promise<string[]> {
  const resource = await repositories.resources.findByName(AUTOMATIONS_RESOURCE_NAME);
  if (!resource) {
    logger.warn(
      `[approval-notifications] AUTOMATIONS resource not seeded; cannot fan out DM`,
    );
    return [];
  }
  const all = await repositories.resourceAccess.findByResource(resource.id);
  const userIds = new Set<string>();
  for (const access of all) {
    if (access.accessType !== AccessType.ADMIN) continue;
    if (access.userId) userIds.add(access.userId);
    if (access.groupId) {
      const mappings = await repositories.userGroupMapping.findMany({
        where: { userGroupId: access.groupId },
      });
      for (const m of mappings) userIds.add(m.userId);
    }
  }
  return [...userIds];
}

function deepLinkToProposal(proposal: AutomationView): string {
  const base = (config.frontendUrl ?? '').replace(/\/$/, '');
  const automationSeriesId = proposal.automationSeriesId ?? proposal.id;
  return `${base}/${encodeURIComponent(proposal.workspaceId)}/automations/${encodeURIComponent(automationSeriesId)}?proposal=${encodeURIComponent(proposal.id)}`;
}

function deepLinkToAutomation(automation: AutomationView): string {
  const base = (config.frontendUrl ?? '').replace(/\/$/, '');
  const seriesId = automation.automationSeriesId ?? automation.id;
  return `${base}/${encodeURIComponent(automation.workspaceId)}/automations/${encodeURIComponent(seriesId)}`;
}

async function dmToUser(
  fromUserId: string,
  toUserId: string,
  workspaceId: string,
  content: string,
): Promise<void> {
  await runAsServiceActor(fromUserId, workspaceId, async () => {
    const channelId = await repositories.channels.findOrCreateDMChannel(
      fromUserId,
      [toUserId],
      repositories.channelParticipants,
      workspaceId,
    );
    await conversationService.createConversationWithMessage({
      channelId,
      userId: fromUserId,
      content,
      msgType: MessageType.BOT,
      isBot: true,
    });
  });
}

function proposerIdOf(proposal: AutomationView): string | null {
  return proposal.createdById || null;
}

export async function notifyAdminsOfSubmission(
  proposal: AutomationView,
): Promise<void> {
  const botId = await getApprovalBotUserId(proposal.workspaceId);
  if (!botId) return;
  const adminIds = await listAutomationsAdminUserIds();
  if (adminIds.length === 0) {
    logger.warn(
      `[approval-notifications] no AUTOMATIONS admins to notify for proposal ${proposal.id}`,
    );
    return;
  }
  const headline = proposal.automationSeriesId === proposal.id
    ? `New automation submitted for approval: *${proposal.name || proposal.id}*`
    : `Change submitted for automation *${proposal.name || proposal.id}*`;
  const body = `${headline}\nReview: ${deepLinkToProposal(proposal)}`;

  await Promise.allSettled(
    adminIds.map(async adminId => {
      try {
        await dmToUser(botId, adminId, proposal.workspaceId, body);
      } catch (err) {
        logger.warn(`[approval-notifications] DM to admin ${adminId} failed`, err);
      }
    }),
  );
  logger.info(
    `[approval-notifications] submission DM fan-out OK proposal=${proposal.id} adminCount=${adminIds.length}`,
  );
}

export async function notifyAdminsOfArchiveRequest(
  automation: AutomationView,
  requestedByUserId: string,
): Promise<void> {
  const botId = await getApprovalBotUserId(automation.workspaceId);
  if (!botId) return;
  const adminIds = await listAutomationsAdminUserIds();
  if (adminIds.length === 0) {
    logger.warn(
      `[approval-notifications] no AUTOMATIONS admins to notify for archive request ${automation.id}`,
    );
    return;
  }
  const body =
    `Archive requested for automation *${automation.name || automation.id}* by user \`${requestedByUserId}\`.\n` +
    `Open: ${deepLinkToAutomation(automation)}`;

  await Promise.allSettled(
    adminIds.map(async adminId => {
      try {
        await dmToUser(botId, adminId, automation.workspaceId, body);
      } catch (err) {
        logger.warn(`[approval-notifications] archive DM to admin ${adminId} failed`, err);
      }
    }),
  );
  logger.info(
    `[approval-notifications] archive request DM fan-out OK id=${automation.id} adminCount=${adminIds.length}`,
  );
}

export async function notifyAuthorOfDecision(
  proposal: AutomationView,
  decision: 'approved' | 'rejected' | 'auto-revoked',
  note: string | null,
): Promise<void> {
  const authorId = proposerIdOf(proposal);
  if (!authorId) return;
  const botId = await getApprovalBotUserId(proposal.workspaceId);
  if (!botId) return;

  const verbLine = {
    approved: `was approved`,
    rejected: `was rejected`,
    'auto-revoked': `was auto-revoked (another proposal in the same automation got approved first)`,
  }[decision];

  const body =
    `Your proposal for *${proposal.name || proposal.id}* ${verbLine}.\n` +
    (note ? `Note: ${note}\n` : '') +
    `Open: ${deepLinkToProposal(proposal)}`;

  try {
    await dmToUser(botId, authorId, proposal.workspaceId, body);
  } catch (err) {
    logger.warn(
      `[approval-notifications] decision DM to ${authorId} failed`,
      err,
    );
  }
}
