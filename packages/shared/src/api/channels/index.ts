import { route } from '../../enc-contracts/api-route.js';
import { z } from 'zod';
import { tagsConfig } from './tags-config/index.js';

// ─── Channel lookups and checks (/channels/...): dashboard login. ───────────────────────
// Names, ids, member lists and settings. No message content, nothing encrypted. Creating a
// channel, DMs and conversations are not here.

const channelId = z.object({ channelId: z.string().min(1, 'channelId is required') });
const deskApp = z.object({
  id: z.string(),
  displayName: z.string(),
  externalIdentifier: z.string().nullable(),
  packageName: z.string().nullable(),
  isActive: z.boolean(),
});
/** A mention candidate: a user or a group (told apart by `type`). */
const mentionResult = z.union([
  z.object({ id: z.string(), name: z.string(), email: z.string(), picture: z.string().nullable(), type: z.literal('user') }),
  z.object({
    id: z.string(),
    name: z.string(),
    alias: z.string().nullable(),
    description: z.string().nullable(),
    memberCount: z.number(),
    type: z.literal('group'),
  }),
]);

/** `/channels`: channel lookups and checks, and a channel's tags config. Key order is the mount order. */
export const channels = route('/channels', {
  checkDuplicate: {
    method: 'POST',
    path: '/check-duplicate',
    // `projectId` is accepted for old clients; the check is workspace-wide.
    body: z.object({ name: z.string().min(1, 'Name is required'), projectId: z.string().optional() }),
    response: z.object({ isDuplicate: z.boolean(), name: z.string(), projectId: z.string().optional() }),
  },
  /** Users and groups to mention: `q` is at least one character; `limit` max 15 (default 10); `types` is `users,groups`. */
  search: {
    method: 'GET',
    path: '/search',
    query: z.object({
      q: z.string().refine((value) => value.trim().length >= 1, 'Search query (q) is required and must be at least 1 character'),
      limit: z.string().optional(),
      types: z.string().optional(),
    }),
    response: z.object({
      results: z.array(mentionResult),
      total: z.number(),
      query: z.string(),
      limit: z.number(),
      types: z.array(z.string()),
    }),
  },
  memberCounts: {
    method: 'POST',
    path: '/member-counts',
    body: z.object({ channelIds: z.array(z.string()).max(10000, 'channelIds exceeds the maximum of 10000') }),
    response: z.object({ success: z.literal(true), data: z.object({ counts: z.record(z.string(), z.number()) }) }),
  },
  /** Channels the caller can publish docs to (default and document scope; no DMs). */
  publishTargets: {
    method: 'GET',
    path: '/publish-targets',
    response: z.object({ channels: z.array(z.object({ id: z.string(), name: z.string(), projectId: z.string(), scopeType: z.string() })) }),
  },
  connectedEmail: {
    method: 'GET',
    path: '/:channelId/connected-email',
    params: channelId,
    response: z.object({
      email: z.string().nullable(),
      isConnected: z.boolean(),
      hasSource: z.boolean(),
      sourceType: z.string().nullable(),
      connectedLabel: z.string().nullable(),
      outboundConfigured: z.boolean(),
      deskApps: z.array(deskApp),
      googlePlayApps: z.array(deskApp),
    }),
  },
  emailAlias: {
    method: 'GET',
    path: '/:channelId/email-alias',
    params: channelId,
    response: z.object({
      emailAlias: z.string().nullable(),
      configured: z.boolean(),
      isActive: z.boolean(),
      sourceType: z.string().nullable(),
      mailboxEmail: z.string().nullable(),
    }),
  },
  vespaParticipants: {
    method: 'GET',
    path: '/:channelId/vespa-participants',
    params: channelId,
    response: z.object({ success: z.literal(true), data: z.object({ userIds: z.array(z.string()) }) }),
  },
  members: {
    method: 'GET',
    path: '/:channelId/members',
    params: channelId,
    response: z.object({ success: z.literal(true), data: z.object({ members: z.array(z.object({ id: z.string(), name: z.string() })) }) }),
  },
  /** Whether the caller may link boards to this channel (a UI gate; the ACL still enforces). */
  canLinkBoards: {
    method: 'GET',
    path: '/:channelId/can-link-boards',
    params: channelId,
    response: z.object({ success: z.literal(true), data: z.object({ canLinkBoards: z.boolean() }) }),
  },
  shareAgentStatus: {
    method: 'GET',
    path: '/:channelId/share-agent-conversation/status',
    params: channelId,
    query: z.object({
      agentSlug: z.string().min(1, 'agentSlug is required'),
      sourceConversationId: z.string().min(1, 'sourceConversationId is required'),
      activePathTipMessageId: z.string().optional(),
    }),
    response: z.object({
      previouslyShared: z.boolean(),
      lastSharedAt: z.string().nullable(),
      hasNewSinceLastShare: z.boolean(),
      agentInChannel: z.boolean(),
      canAddAgent: z.boolean(),
      agentInstalled: z.boolean(),
      channelVisibility: z.string(),
      channelScopeType: z.string(),
    }),
  },
  tagsConfig,
});
