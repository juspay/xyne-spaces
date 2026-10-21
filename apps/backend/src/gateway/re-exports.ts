// The only file in gateway/ that imports from outside it. Everything the gateway uses from the repo is listed here.

export { db } from '@/database/client';
export { repositories } from '@/database/repositories';
export { ExternalSourceRepository } from '@/database/repositories/externalSourceRepository';
export { ExternalMessageRepository } from '@/database/repositories/externalMessageRepository';
export { runWithContext, withWorkspaceScope } from '@/database/tenant/context';

export { logger } from '@/utils/logger';
export { AppError } from '@/middleware/errorHandler';
export { encrypt, decrypt } from '@/services/encryptionService';
export { acquireLock, releaseLock } from '@/utils/distributedLock';
export type { LockHandle } from '@/utils/distributedLock';
export { redisService } from '@/services/redisService';
export { getBackendUrl, getFrontendUrl } from '@/utils/publicUrls';

export { authMiddleware } from '@/middleware/auth';
export { webhookLimiter } from '@/middleware/rateLimiters';
export type { RawBodyRequest } from '@/types/express';

export { conversationService } from '@/services/conversationService';
export { deleteConversationMessage } from '@/apps/core/conversationUtils';
export { MessagesSideEffectHandler } from '@/zero/side-effects/tables/messages-handler';
export { buildUserQueryContext } from '@/utils/queryContext';
export { ExternalAttachmentService } from '@/services/externalAttachmentService';
export type { ExternalAttachment } from '@/services/externalAttachmentService';

export { findOrCreateUser, findOrCreateApp } from '@/migration/scripts/ingestConversationSlack';
export {
  buildSlackChannelSourceName,
  buildSlackMigrationSourceName,
} from '@/migration/slack/slackMigrationSource';
export { buildSlackDeskSourceName } from '@/integrations/core/deskSources';
export { resolveSlackMentions } from '@/integrations/adapters/slack-webhook-tickets/utils/slackUserResolver';
export { SlackBlockKitParser } from '@/integrations/adapters/slack-webhook-tickets/utils/slackBlockKitParser';
export type { SlackAttachment } from '@/integrations/adapters/slack-webhook-tickets/utils/slackBlockKitTypes';
export { htmlToSlackMrkdwn } from '@/integrations/adapters/slack-desk/slackMrkdwn';

export {
  AttachmentEntityType,
  ChannelScopeType,
  ExternalEntityType,
  MessageDirection,
  MessageType,
  isDeskChannelType,
} from '@xyne/shared';
export { extractUserMentions } from '@xyne/shared/utils';
