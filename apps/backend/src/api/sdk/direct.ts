/**
 * Direct API operations: everything that is not a Zero catalog query or mutator.
 *
 * These are the gaps in the catalog — server-side sequence allocation, multipart
 * uploads, and Vespa search. Each one already exists as a product controller
 * that the app itself calls, and each owns behaviour it would be reckless to
 * fork: sequence allocation, file storage, permission filtering, mail dedupe,
 * ranking. So none of it is reimplemented here. A route names a controller, and
 * `callController` runs it.
 *
 * Controllers write their own Express response, so they are invoked through a
 * capturing stub: the body is intercepted, then re-emitted in the SDK shape with
 * failures translated into the SDK error envelope. The product routes those
 * controllers also serve are untouched.
 *
 * Authentication: Cookie-based auth via authMiddleware (same as dashboard).
 */

import { Router, type NextFunction, type Request, type RequestHandler, type Response } from 'express';
import { z, type ZodTypeAny } from 'zod';
import { AccessType, MAX_RULES, NotificationStatus } from '@xyne/shared';
import { searchQuerySchema, searchSchemaQuerySchema } from './schemas/search';
import { db } from '@/database/client';
import type { AuthData } from '@/zero/mutators';
import { ChannelController } from '@/controllers/channelController';
import { ConversationController } from '@/controllers/conversationController';
import { TicketController } from '@/controllers/ticketController';
import { AttachmentController } from '@/controllers/attachmentController';
import { DraftAttachmentController } from '@/controllers/draftAttachmentController';
import { callController as callsController } from '@/controllers/callController';
import { affinityController } from '@/controllers/affinityController';
import { userManagementController } from '@/controllers/userManagementController';
import { notificationController } from '@/controllers/notificationController';
import * as dailyBriefController from '@/controllers/dailyBriefController';
import { customEmojiController } from '@/controllers/customEmojiController';
import { CanvasController } from '@/controllers/canvasController';
import { workspaceScopedRoute } from '@/database/tenant/context';
import { repositories } from '@/database/repositories/index';
import { MessageAttachmentRepository } from '@/database/repositories/messageAttachmentRepository';
import { authorize } from '@/middleware/authorize';
import { notificationService } from '@/services/notificationService';
import { RadarActionError, radarManualActions } from '@/services/radar/radarManualActions';
import { radarFeedService } from '@/services/radar/radarFeedService';
import { radarRuleStore } from '@/services/radar/radarRuleStore';
import { canReadTicket } from '@/services/subTicketLinkService';
import { cleanConditions, parsePageQuery } from '@/routes/radarExecution';
import { searchHandler } from '@/services/vespaSearch';
import { schemaHandler } from '@/services/vespaSearch/schemaHandler';
import {
  getS2SClawRunStatus,
  listScopedClawAgents,
  runScopedClawAgent,
  ClawAgentNotAvailableError,
  type ScopedClawIdentity,
} from '@/services/clawAgentService';
import {
  callConnectorTool,
  listConnectorTools,
  listConnectors,
  startConnectorConnect,
  ConnectorNotConnectedError,
  ConnectorNotFoundError,
  ConnectorValidationError,
  ConnectorRateLimitedError,
  ConnectorWriteToolError,
} from '@/services/clawConnectorsService';
import { uploadMultiple, uploadSingle } from '@/middleware/upload';
import { config } from '@/config/env';
import { SdkApiError } from './errors';
import { handle } from './handler';

const channelController = new ChannelController();
const conversationController = new ConversationController();
const ticketController = new TicketController();
const attachmentController = new AttachmentController();
const draftAttachmentController = new DraftAttachmentController();
// Constructed the way routes/canvas.ts constructs it.
const canvasController = new CanvasController(new MessageAttachmentRepository());

/**
 * Build SDK auth data from req.user (set by authMiddleware).
 * Fetches orgId from the database since it's not available on req.user.
 */
/**
 * Who a Claw call acts as.
 *
 * `orgId` is passed explicitly rather than left for claw-auth to derive: it
 * derives one from a session cookie, and a bearer-authenticated SDK caller has
 * no cookie to derive it from. Without it the roster is not narrowed to one
 * org and the same agent comes back once per org the user belongs to.
 *
 * The cookie is still forwarded when there is one, so a browser caller keeps
 * whatever claw-auth infers from it.
 */
function clawIdentity(req: Request, authData: AuthData): ScopedClawIdentity {
  return {
    userId: authData.sub,
    ...(authData.orgId ? { orgId: authData.orgId } : {}),
    ...(authData.workspaceId ? { workspaceId: authData.workspaceId } : {}),
    ...(req.headers.cookie ? { cookie: req.headers.cookie } : {}),
  };
}

async function buildAuthData(req: Request): Promise<AuthData> {
  const user = req.user;
  if (!user) {
    throw new SdkApiError('unauthenticated', 'Missing authenticated principal.');
  }

  // Fetch orgId from orgMember table (not available on req.user)
  const orgMember = await db.orgMember.findUnique({
    where: { memberId: user.memberId },
    select: { orgId: true },
  });

  if (!orgMember) {
    throw new SdkApiError('unauthenticated', 'Organization membership not found.');
  }

  return {
    sub: user.id,
    email: user.email,
    name: user.name,
    displayName: user.displayName ?? undefined,
    workspaceId: user.workspaceId,
    orgId: orgMember.orgId,
    role: user.role,
    orgRole: user.orgRole,
    memberId: user.memberId,
  };
}

/**
 * A product controller: writes its response rather than returning it. Some
 * return the `res` they wrote to; that value is ignored.
 */
type Controller = (req: Request, res: Response) => Promise<unknown> | void;

/** A service function: returns its payload, so nothing needs capturing. */
type Service = (req: Request, authData: AuthData) => Promise<unknown>;

/**
 * A check that runs before the handler and throws an `SdkApiError` to refuse.
 *
 * For the routes whose product counterpart is protected by something that does
 * not apply under /api/sdk — a URL-keyed ACL, or nothing at all — so the
 * protection is restated here rather than assumed.
 */
type Guard = (req: Request) => Promise<void>;

interface BaseRoute {
  readonly method: 'get' | 'post' | 'put' | 'patch' | 'delete';
  /** Express path relative to the /api/sdk mount. */
  readonly path: string;
  /** Route-local parsing, such as multipart handling. */
  readonly middleware?: readonly RequestHandler[];
  /** Validates and coerces the query string before the handler sees it. */
  readonly query?: ZodTypeAny;
  /** Validates and coerces the body before the handler sees it. */
  readonly body?: ZodTypeAny;
  /** Adjust the query the controller receives. */
  readonly mapQuery?: (query: Record<string, unknown>) => Record<string, unknown>;
  /** Adjust the body the controller receives. */
  readonly mapBody?: (body: unknown) => unknown;
  /** Unwrap the controller's envelope into the SDK's response shape. */
  readonly unwrap?: (body: unknown) => unknown;
  /** Run in order before the handler; any of them may refuse the request. */
  readonly guards?: readonly Guard[];
}

/**
 * A route is backed by one of two things, never both: a product controller that
 * writes an Express response, or a service function that returns a value.
 */
type DirectRoute =
  | (BaseRoute & { readonly controller: Controller; readonly service?: never })
  | (BaseRoute & { readonly service: Service; readonly controller?: never });

/**
 * A Claw run request.
 *
 * `channelId` is the one real bridge between the two services: supplying one
 * makes the agent post its reply into that Spaces thread as well as returning it.
 */
const clawRunBody = z.object({
  agent: z.string().min(1),
  task: z.string().min(1),
  conversationId: z.string().min(1).optional(),
  channelId: z.string().min(1).optional(),
  context: z.string().optional(),
});

/** A connector's `McpServer.type`, as it appears in `/connectors/:type/...`. */
const CONNECTOR_TYPE = /^[a-z0-9][a-z0-9_-]{0,63}$/;

function connectorType(req: Request): string {
  const type = req.params['type'];
  if (!type || !CONNECTOR_TYPE.test(type)) {
    throw new SdkApiError('validation_failed', 'Invalid connector type.');
  }
  return type;
}

const connectorCallBody = z
  .object({
    tool: z.string().min(1).max(200),
    args: z.record(z.unknown()).optional(),
  })
  .strict();

const connectorConnectBody = z
  .object({
    returnTo: z.string().url().max(2048).optional(),
  })
  .strict();

/**
 * Where the browser lands after an OAuth consent: the dashboard that made the
 * request. claw-auth re-validates it against its own allowlist regardless.
 */
function defaultReturnTo(req: Request): string {
  const origin = req.headers.origin;
  if (origin && /^https?:\/\//.test(origin)) return origin;
  return config.frontendUrl;
}

/** The dashboard's connector page, where credential-form connectors are set up. */
function connectorSettingsUrl(authData: AuthData, type: string): string {
  const base = config.frontendUrl.replace(/\/+$/, '');
  return `${base}/${encodeURIComponent(authData.workspaceId)}/ai/library/mcp/${encodeURIComponent(type)}`;
}

/** `GET /notifications`: the product route's paging, with its 100-row cap as a bound. */
const notificationListQuery = z.object({
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  status: z.nativeEnum(NotificationStatus).optional(),
});

const dailyBriefLimitQuery = z.object({
  limit: z.coerce.number().int().min(1).optional(),
});

const ROUTES: readonly DirectRoute[] = [
  {
    method: 'post',
    path: '/channels',
    controller: channelController.createChannel,
  },
  {
    method: 'post',
    path: '/channels/check-duplicate',
    controller: channelController.checkDuplicate,
  },
  {
    method: 'post',
    path: '/tickets',
    middleware: [uploadMultiple],
    controller: ticketController.createTicket,
    // Multipart turns every field into a string; these two arrive as JSON.
    mapBody: (body) => reviveJsonFields(body, ['metadata', 'dynamicFields']),
  },
  {
    method: 'post',
    path: '/channels/:channelId/conversations',
    middleware: [uploadMultiple],
    controller: conversationController.createConversation,
  },
  {
    method: 'post',
    path: '/attachments',
    middleware: [uploadMultiple],
    controller: attachmentController.uploadAttachments.bind(attachmentController),
  },
  {
    method: 'post',
    path: '/draft-attachments',
    middleware: [uploadMultiple],
    controller: draftAttachmentController.uploadDraftAttachment.bind(draftAttachmentController),
  },

  /*
   * Calls. The room is provisioned and the media token minted by the calls
   * controller, so starting, joining and leaving a call live here rather than in
   * the catalog. Also reached by operation id: `calls.initiate`, `calls.join` and
   * `calls.leave` resolve to these routes (see v1/mapper.ts).
   */
  {
    method: 'post',
    path: '/calls/initiate',
    controller: callsController.initiateCall,
    unwrap: unwrapEnvelope,
  },
  {
    method: 'post',
    path: '/calls/join',
    // As on the product route: the call link is the invitation, so the handler's
    // lookups run at workspace scope and joinCall checks the workspace itself.
    middleware: [workspaceScopedRoute],
    controller: callsController.joinCall,
    unwrap: unwrapEnvelope,
  },
  {
    method: 'post',
    path: '/calls/:callId/leave',
    controller: callsController.leaveCall,
    unwrap: unwrapEnvelope,
  },
  {
    method: 'get',
    path: '/search',
    controller: searchHandler,
    query: searchQuerySchema,
    // The handler rejects an absent `q` even though it supports filter-only
    // searches behind an explicit flag. Set the flag so callers can omit `q`.
    mapQuery: (query) => {
      const q = typeof query['q'] === 'string' ? query['q'] : '';
      return q ? { ...query, q } : { ...query, q, filterOnly: 'true' };
    },
    unwrap: unwrapEnvelope,
  },
  {
    method: 'get',
    path: '/search/schema',
    controller: schemaHandler,
    query: searchSchemaQuerySchema,
    unwrap: unwrapEnvelope,
  },

  /**
   * Who the authenticated user is.
   *
   * COOKIE-BASED AUTH: Returns user info from req.user (authData).
   * API KEY AUTH (COMMENTED OUT): Also returned keyExpiresAt from auth.keyExpiresAt.
   */
  {
    method: 'get',
    path: '/me',
    // COOKIE-BASED AUTH (ACTIVE) - uses authData built from req.user
    service: async (_req, authData) => {
      return {
        id: authData.sub,
        email: authData.email,
        name: authData.name,
        displayName: authData.displayName ?? null,
        workspaceId: authData.workspaceId,
        orgId: authData.orgId,
        memberId: authData.memberId,
        role: authData.role,
        orgRole: authData.orgRole,
        // keyExpiresAt is only available with API key auth, omitted for cookie auth
      };
    },
    // API KEY AUTH (COMMENTED OUT) - used auth.authData and auth.keyExpiresAt
    // service: async (_req, auth) => {
    //   const { authData } = auth;
    //   return {
    //     id: authData.sub,
    //     email: authData.email,
    //     name: authData.name,
    //     displayName: authData.displayName ?? null,
    //     workspaceId: authData.workspaceId,
    //     orgId: authData.orgId,
    //     memberId: authData.memberId,
    //     role: authData.role,
    //     orgRole: authData.orgRole,
    //     keyExpiresAt: auth.keyExpiresAt.toISOString(),
    //   };
    // },
  },

  /*
   * Claw runs through Spaces rather than being reached directly.
   *
   * `clawAgentService` already speaks to claw-auth with the deployment's own
   * service credential, so a caller needs no second login and Claw needs no
   * knowledge of API keys. The S2S variants are the ones that take an explicit
   * identity — `userId`, `userName`, `userEmail`, and the three `spaces*` fields
   * map one-to-one onto `AuthData` — and return a session id that can be polled.
   * The non-S2S `runClawAgent` is the app-mention path: it requires a channel and
   * conversation to post into and returns only whether it dispatched, so a result
   * cannot be read back.
   */
  {
    method: 'get',
    path: '/claw/agents',
    // COOKIE-BASED AUTH (ACTIVE) - scoped to the acting user, see clawIdentity
    service: async (req, authData) => listScopedClawAgents(clawIdentity(req, authData)),
  },
  {
    method: 'post',
    path: '/claw/runs',
    body: clawRunBody,
    // COOKIE-BASED AUTH (ACTIVE) - uses authData built from req.user
    service: async (req, authData) => {
      const input = clawRunBody.parse(req.body);
      const result = await runScopedClawAgent({
        identity: clawIdentity(req, authData),
        agentSlug: input.agent,
        task: input.task,
        userId: authData.sub,
        userName: authData.displayName || authData.name || authData.email,
        userEmail: authData.email,
        spacesWorkspaceId: authData.workspaceId,
        spacesOrgId: authData.orgId,
        spacesOrgMemberId: authData.memberId,
        workspaceId: authData.workspaceId,
        // Required by the webhook contract. The run is polled through
        // `/claw/runs/:sessionId` rather than delivered here, but claw-auth
        // rejects a run without somewhere to call back to.
        callbackUrl: config.xyneClaw.callbackUrl,
        ...(input.conversationId ? { conversationId: input.conversationId } : {}),
        ...(input.channelId ? { channelId: input.channelId } : {}),
        ...(input.context ? { context: input.context } : {}),
      });
      return { sessionId: result.sessionId };
    },
  },
  {
    method: 'get',
    path: '/claw/runs/:sessionId',
    // COOKIE-BASED AUTH (ACTIVE) - uses authData.sub from req.user
    service: async (req, authData) => {
      const sessionId = req.params['sessionId'];
      if (!sessionId) throw new SdkApiError('validation_failed', 'sessionId is required.');
      const status = await getS2SClawRunStatus(sessionId, authData.sub);
      if (!status) throw SdkApiError.notFound('Claw run');
      return status;
    },
  },

  /*
   * Connectors: an app reads external data through the VIEWER's own claw-auth
   * connection (personal, or the org's shared one). The call is relayed to
   * claw-auth, which runs the MCP tool server-side, so the credential never
   * reaches the app. Read-only in v1 — write tools are refused with 403.
   */
  {
    method: 'get',
    path: '/connectors',
    // COOKIE-BASED AUTH (ACTIVE) - runs as authData.sub
    service: async (_req, authData) => ({ connectors: await listConnectors(authData.sub) }),
  },
  {
    method: 'get',
    path: '/connectors/:type/tools',
    service: async (req, authData) => ({
      tools: await listConnectorTools(authData.sub, connectorType(req)),
    }),
  },
  {
    method: 'post',
    path: '/connectors/:type/call',
    body: connectorCallBody,
    service: async (req, authData) => {
      const type = connectorType(req);
      const input = connectorCallBody.parse(req.body);
      return callConnectorTool(authData.sub, type, input.tool, input.args ?? {});
    },
  },
  {
    method: 'post',
    path: '/connectors/:type/connect',
    body: connectorConnectBody,
    service: async (req, authData) => {
      const type = connectorType(req);
      const input = connectorConnectBody.parse(req.body);
      return startConnectorConnect(authData.sub, type, {
        returnTo: input.returnTo ?? defaultReturnTo(req),
        settingsUrl: connectorSettingsUrl(authData, type),
      });
    },
  },

  /*
   * The caller: personalization weights, people search, and DMs.
   */
  {
    method: 'get',
    path: '/me/affinity',
    controller: affinityController.getAffinity,
  },
  {
    method: 'get',
    path: '/users/search',
    controller: userManagementController.searchUsers,
    query: z.object({
      q: z.string().min(1),
      limit: z.coerce.number().int().min(1).max(100).optional(),
      offset: z.coerce.number().int().min(0).optional(),
    }),
    unwrap: unwrapUserSearch,
  },
  {
    method: 'get',
    path: '/me/dms',
    controller: channelController.getUserDMs,
  },
  {
    method: 'post',
    path: '/me/dms',
    controller: channelController.createNewDM,
    body: z.object({
      participantIds: z.array(z.string().min(1)).min(1),
      message: z.string().optional(),
      forwardedMessage: z
        .object({ originalMessageId: z.string().min(1), optionalMessage: z.string().optional() })
        .optional(),
      silent: z.boolean().optional(),
    }),
  },

  /*
   * Notifications: the caller's in-app notification inbox and preferences.
   * Reads that are a single service call go to the service; the rest reuse the
   * controller, which also clears channel/thread unread state on markAsRead.
   */
  {
    method: 'get',
    path: '/notifications',
    query: notificationListQuery,
    service: async (req, authData) => {
      const { page, limit, status } = notificationListQuery.parse(req.query);
      return notificationService.getUserNotifications(authData.sub, {
        page: page ?? 1,
        limit: limit ?? 20,
        ...(status ? { status } : {}),
      });
    },
  },
  {
    method: 'get',
    path: '/notifications/unread-count',
    service: async (_req, authData) => ({
      count: await notificationService.getUnreadCount(authData.sub),
    }),
  },
  {
    method: 'get',
    path: '/notifications/workspace-counts',
    controller: notificationController.getWorkspaceNotificationCounts.bind(notificationController),
  },
  {
    method: 'patch',
    path: '/notifications/mark-all-read',
    service: async (_req, authData) => {
      await notificationService.markAllAsRead(authData.sub);
      return {};
    },
  },
  {
    method: 'patch',
    path: '/notifications/:id/read',
    controller: notificationController.markAsRead.bind(notificationController),
    body: z.object({
      channelId: z.string().min(1).optional(),
      conversationId: z.string().min(1).optional(),
    }),
    unwrap: unwrapEnvelope,
  },
  {
    method: 'patch',
    path: '/notifications/:id/dismiss',
    controller: notificationController.dismiss.bind(notificationController),
    unwrap: unwrapEnvelope,
  },
  {
    method: 'get',
    path: '/notifications/preferences',
    controller: notificationController.getPreferences.bind(notificationController),
  },
  {
    method: 'put',
    path: '/notifications/preferences',
    // Validated by the controller against its own preferencesSchema, after it
    // drops retired notification types — so a stale client still saves.
    controller: notificationController.updatePreferences.bind(notificationController),
    unwrap: unwrapEnvelope,
  },

  /*
   * Daily brief. Stored and generated by claw-auth; these relay the caller's
   * request. The org-wide settings write is admin-only, enforced by claw-auth.
   */
  {
    method: 'get',
    path: '/daily-brief/latest',
    controller: dailyBriefController.getLatest,
  },
  {
    method: 'get',
    path: '/daily-brief/history',
    controller: dailyBriefController.getHistory,
    query: dailyBriefLimitQuery,
  },
  {
    method: 'get',
    path: '/daily-brief/dates',
    controller: dailyBriefController.getDates,
    query: dailyBriefLimitQuery,
  },
  {
    method: 'get',
    path: '/daily-brief/by-date/:date',
    controller: dailyBriefController.getByDate,
    guards: [briefDateGuard],
  },
  {
    method: 'get',
    path: '/daily-brief/config',
    controller: dailyBriefController.getConfig,
  },
  {
    method: 'put',
    path: '/daily-brief/config',
    controller: dailyBriefController.saveConfig,
    body: z.object({
      enabled: z.boolean().optional(),
      instructions: z.string().optional(),
      instructionsEnabled: z.boolean().optional(),
    }),
  },
  {
    method: 'get',
    path: '/daily-brief/settings',
    controller: dailyBriefController.getSettings,
  },
  {
    method: 'put',
    path: '/daily-brief/settings',
    controller: dailyBriefController.saveSettings,
    body: z.object({ agentSlug: z.string().min(1).nullable() }),
  },

  /*
   * Radar. The product handlers are closures in routes/radarExecution.ts, so
   * these call the same services with the same caller context, and share that
   * router's query and rule-condition parsing.
   */
  {
    method: 'get',
    path: '/radar/feed/pending-me',
    service: async (_req, authData) => ({ threads: await radarFeedService.pendingMe(radarAuth(authData)) }),
  },
  {
    method: 'get',
    path: '/radar/feed/waiting-on',
    service: async (_req, authData) => ({ threads: await radarFeedService.waitingOn(radarAuth(authData)) }),
  },
  {
    method: 'get',
    path: '/radar/feed/pending-others',
    service: async (req, authData) => {
      const auth = radarAuth(authData);
      // Paged when the caller asks for a page; the whole feed otherwise, as on
      // the product route.
      if (typeof req.query['page'] === 'string') {
        return radarFeedService.pendingOthersPage(auth, parsePageQuery(req.query));
      }
      return { threads: await radarFeedService.pendingOthers(auth) };
    },
  },
  {
    method: 'post',
    path: '/radar/items/:itemId/resolve',
    service: async (req, authData) =>
      radarAction(() => radarManualActions.resolveItem(radarAuth(authData), pathParam(req, 'itemId'))),
  },
  {
    method: 'post',
    path: '/radar/items/:itemId/dismiss',
    service: async (req, authData) =>
      radarAction(() => radarManualActions.dismissItem(radarAuth(authData), pathParam(req, 'itemId'))),
  },
  {
    method: 'get',
    path: '/radar/rules',
    service: async (_req, authData) => ({ rules: await radarRuleStore.list(radarAuth(authData)) }),
  },
  {
    method: 'post',
    path: '/radar/rules',
    service: async (req, authData) => {
      const conditions = radarConditions(req);
      // Counted and written together, as on the product route.
      const rule = await radarRuleStore.createWithinLimit(radarAuth(authData), conditions, MAX_RULES);
      if (!rule) throw new SdkApiError('validation_failed', `At most ${MAX_RULES} rules`);
      return { rule };
    },
  },
  {
    method: 'patch',
    path: '/radar/rules/:ruleId',
    service: async (req, authData) => {
      const conditions = radarConditions(req);
      const rule = await radarRuleStore.update(radarAuth(authData), pathParam(req, 'ruleId'), conditions);
      if (!rule) throw SdkApiError.notFound('Rule');
      return { rule };
    },
  },
  {
    method: 'delete',
    path: '/radar/rules/:ruleId',
    service: async (req, authData) => {
      const ruleId = pathParam(req, 'ruleId');
      if (!(await radarRuleStore.remove(radarAuth(authData), ruleId))) throw SdkApiError.notFound('Rule');
      return { id: ruleId };
    },
  },

  /*
   * Channels: mention search, member counts and a channel's roster. The roster
   * controller checks membership itself.
   */
  {
    method: 'get',
    path: '/channels/search',
    controller: channelController.searchForMentions,
    query: z.object({
      q: z.string().min(1),
      limit: z.string().regex(/^\d+$/).optional(),
      types: z.string().optional(),
    }),
  },
  {
    method: 'post',
    path: '/channels/member-counts',
    controller: channelController.getChannelMemberCounts,
    body: z.object({ channelIds: z.array(z.string()).max(10000) }),
    unwrap: unwrapEnvelope,
  },
  {
    method: 'get',
    path: '/channels/:channelId/members',
    controller: channelController.getChannelMembers,
    unwrap: unwrapEnvelope,
  },

  /*
   * Conversations: the caller's thread list, recently visited conversations,
   * and a conversation looked up by one of its messages.
   */
  {
    method: 'get',
    path: '/conversations/threads',
    // Pagination is validated by the controller, which also decodes the cursor.
    controller: conversationController.getUserThreads,
  },
  {
    method: 'get',
    path: '/conversations/recent-visited',
    controller: conversationController.getRecentVisitedConversations,
  },
  {
    method: 'get',
    path: '/conversations/by-message/:messageId',
    controller: conversationController.getConversationByMessageId,
    guards: [messageAccessGuard],
  },

  /*
   * Custom emojis. Creation is multipart with the product route's own upload
   * middleware and size cap; only the emoji's creator may delete it, which the
   * controller enforces.
   */
  {
    method: 'get',
    path: '/emojis',
    controller: customEmojiController.getAllCustomEmojis,
    unwrap: (body) => field(body, 'emojis'),
  },
  {
    method: 'get',
    path: '/emojis/:emojiId',
    controller: customEmojiController.getCustomEmojiById,
    unwrap: (body) => field(body, 'emoji'),
  },
  {
    method: 'post',
    path: '/emojis',
    middleware: [uploadSingle({ maxBytes: 256 * 1024 })],
    controller: customEmojiController.createCustomEmoji,
    unwrap: (body) => field(body, 'emoji'),
  },
  {
    method: 'delete',
    path: '/emojis/:emojiId',
    controller: customEmojiController.deleteCustomEmoji,
    unwrap: () => ({}),
  },

  /*
   * Canvases created from markdown, file uploads into a canvas, and labels.
   * Edit access for uploads and label writes is checked by the controller.
   */
  {
    method: 'post',
    path: '/canvases/create',
    controller: canvasController.createCanvas,
    // No sdlcFolderId: SDLC is not exposed, and the schema strips it.
    body: z.object({
      title: z.string().min(1),
      markdown: z.string().min(1),
      visibility: z.enum(['PUBLIC', 'PRIVATE']).optional(),
      channelId: z.string().min(1).optional(),
    }),
    guards: [canvasChannelGuard],
  },
  {
    method: 'post',
    path: '/canvases/upload',
    // Fields are checked by the controller, which also cleans up the stored
    // file when it refuses; a schema here would refuse after the upload.
    middleware: [uploadSingle()],
    controller: canvasController.uploadFile,
  },
  {
    method: 'get',
    path: '/canvases/labels',
    controller: canvasController.getCanvasLabels,
    query: z.object({ canvasIds: z.string().min(1) }),
  },
  {
    method: 'get',
    path: '/canvases/labels/suggestions',
    controller: canvasController.getCanvasLabelSuggestions,
    query: z.object({
      query: z.string().optional(),
      offset: z.string().regex(/^\d+$/).optional(),
      limit: z.string().regex(/^\d+$/).optional(),
    }),
  },
  {
    method: 'post',
    path: '/canvases/:canvasId/labels',
    controller: canvasController.addCanvasLabel,
    body: z.object({ names: z.array(z.string()).min(1) }),
  },
  {
    // POST rather than the product route's DELETE: it carries a body, which
    // not every HTTP client will send on a DELETE.
    method: 'post',
    path: '/canvases/:canvasId/labels/remove',
    controller: canvasController.removeCanvasLabel,
    body: z.object({ labelIds: z.array(z.string()).min(1) }),
    unwrap: unwrapEnvelope,
  },

  /*
   * Ticket field update, including custom form fields and tags. The product
   * route is guarded only by the URL-keyed ACL, which does not apply under
   * /api/sdk, so its protection is restated: the TICKETS write grant, and a
   * ticket the caller can see in their own workspace.
   */
  {
    method: 'patch',
    path: '/tickets/:ticketId',
    controller: ticketController.updateTicket,
    guards: [middlewareGuard(authorize('TICKETS', AccessType.WRITE)), ticketVisibleGuard],
    unwrap: unwrapEnvelope,
  },
];

/** Build the router for every direct operation. */
export function createDirectRouter(): Router {
  const router = Router();

  for (const route of ROUTES) {
    router[route.method](
      route.path,
      ...(route.middleware ?? []),
      handle(async (req: Request, res: Response) => {
        for (const guard of route.guards ?? []) await guard(req);

        if (route.service) {
          const authData = await buildAuthData(req);
          if (route.query) route.query.parse(req.query);
          if (route.body) route.body.parse(req.body);
          try {
            res.status(200).json(await route.service(req, authData));
          } catch (err) {
            if (err instanceof SdkApiError) throw err;
            // An unreachable agent is the caller's mistake, not the server's:
            // 404 with the slug named, rather than a 500 whose message the
            // error envelope replaces with a generic string.
            if (err instanceof ClawAgentNotAvailableError) {
              throw new SdkApiError('not_found', err.message, { cause: err });
            }
            throw connectorError(err) ?? new SdkApiError('internal', serviceMessage(err), { cause: err });
          }
          return;
        }

        const result = await callController(route, req);
        for (const [name, value] of Object.entries(result.headers)) {
          res.setHeader(name, value);
        }
        if (result.status === 204 || result.body === undefined) {
          res.status(result.status).end();
          return;
        }
        res.status(result.status).json(result.body);
      }),
    );
  }

  return router;
}

interface ControllerResult {
  readonly status: number;
  readonly body: unknown;
  readonly headers: Record<string, string>;
}

/**
 * Run a product controller as the authenticated caller.
 *
 * The controller is handed a request with the authenticated user on `req.user`,
 * which is where both the controllers and `tenantScopeMiddleware` read identity from.
 */
export async function callController(
  route: DirectRoute & { controller: Controller },
  req: Request,
): Promise<ControllerResult> {
  const user = req.user;
  if (!user) throw new SdkApiError('unauthenticated', 'Missing authenticated principal.');

  const query = route.query
    ? (route.query.parse(req.query) as Record<string, unknown>)
    : (req.query as Record<string, unknown>);
  // The parsed body, not the raw one: the schema also strips what the route
  // does not accept, before the controller can act on it.
  const requestBody: unknown = route.body ? route.body.parse(req.body ?? {}) : req.body;

  const proxyReq = Object.create(req) as Request;
  Object.defineProperties(proxyReq, {
    user: { value: user, writable: true, configurable: true },
    params: { value: req.params, writable: true, configurable: true },
    query: {
      value: route.mapQuery ? route.mapQuery(query) : query,
      writable: true,
      configurable: true,
    },
    body: {
      value: route.mapBody ? route.mapBody(requestBody) : requestBody,
      writable: true,
      configurable: true,
    },
  });

  let status = 200;
  let body: unknown;
  let settled = false;
  const headers = new Map<string, string>();

  const stub = {
    status(code: number) {
      status = code;
      return stub;
    },
    json(payload: unknown) {
      body = payload;
      settled = true;
      return stub;
    },
    send(payload: unknown) {
      body = payload;
      settled = true;
      return stub;
    },
    end() {
      settled = true;
      return stub;
    },
    setHeader(name: string, value: string | number | readonly string[]) {
      headers.set(name, Array.isArray(value) ? value.join(', ') : String(value));
      return stub;
    },
    get headersSent() {
      return settled;
    },
  };

  await route.controller(proxyReq, stub as unknown as Response);

  if (!settled) {
    throw new SdkApiError('internal', 'The handler produced no response.');
  }
  if (status >= 400) throw controllerError(status, body);

  return {
    status,
    body: route.unwrap ? route.unwrap(body) : body,
    headers: Object.fromEntries(headers),
  };
}

/** One field of a `{ success, <field> }` envelope. */
function field(raw: unknown, name: string): unknown {
  const body = raw as Record<string, unknown> | undefined;
  if (body?.['success'] === false) {
    throw new SdkApiError('internal', typeof body['error'] === 'string' ? body['error'] : 'The request failed.');
  }
  return body?.[name];
}

/**
 * User search keeps its `{ data, pagination }` shape, minus the two fields that
 * describe how a user signs in rather than who they are.
 */
function unwrapUserSearch(raw: unknown): unknown {
  const body = raw as { data?: unknown; pagination?: unknown } | undefined;
  const rows = Array.isArray(body?.data) ? (body.data as Record<string, unknown>[]) : [];
  return {
    data: rows.map(({ authProvider: _authProvider, orgMemberId: _orgMemberId, ...user }) => user),
    pagination: body?.pagination,
  };
}

/** A path parameter Express has already matched, so present by construction. */
function pathParam(req: Request, name: string): string {
  const value = req.params[name];
  if (!value) throw new SdkApiError('validation_failed', `${name} is required.`);
  return value;
}

// ----- radar -----

/**
 * The caller as radar sees them. As on the product routes, a caller with no
 * resolved role is refused rather than evaluated under the member rule.
 */
function radarAuth(authData: AuthData): { userId: string; workspaceId: string; role: string } {
  if (!authData.role) throw new SdkApiError('unauthenticated', 'Missing authenticated principal.');
  return { userId: authData.sub, workspaceId: authData.workspaceId, role: authData.role };
}

/** A manual radar action, with its typed refusals mapped as the product route maps them. */
async function radarAction<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (err) {
    if (!(err instanceof RadarActionError)) throw err;
    const code = err.code === 'not-found' ? 'not_found' : err.code === 'forbidden' ? 'forbidden' : 'validation_failed';
    throw new SdkApiError(code, err.message, { cause: err });
  }
}

/** A rule's conditions, rebuilt by the product router's own cleaner. */
function radarConditions(req: Request): { scope: string; values: string[] }[] {
  const cleaned = cleanConditions((req.body as { conditions?: unknown } | undefined)?.conditions);
  if ('error' in cleaned) throw new SdkApiError('validation_failed', cleaned.error);
  return cleaned.conditions;
}

// ----- guards -----

/**
 * Run an Express middleware as a guard.
 *
 * The middleware answers a refusal itself, in the product's shape; that answer
 * is captured and re-raised as the SDK error for its status. Calling `next`
 * means it passed.
 */
function middlewareGuard(middleware: RequestHandler): Guard {
  return (req) =>
    new Promise<void>((resolve, reject) => {
      let status = 200;
      const stub = {
        status(code: number) {
          status = code;
          return stub;
        },
        json(payload: unknown) {
          reject(controllerError(status, payload));
          return stub;
        },
      };
      const next: NextFunction = (err?: unknown) => (err ? reject(err) : resolve());
      Promise.resolve(middleware(req, stub as unknown as Response, next)).catch(reject);
    });
}

const BRIEF_DATE = /^\d{4}-\d{2}-\d{2}$/;

async function briefDateGuard(req: Request): Promise<void> {
  if (!BRIEF_DATE.test(req.params['date'] ?? '')) {
    throw new SdkApiError('validation_failed', 'date must be YYYY-MM-DD.');
  }
}

/**
 * The access `getConversationMessage` requires, applied to the conversation a
 * message belongs to: same workspace, membership when the channel is private,
 * and a message not addressed only to somebody else. `getConversationByMessageId`
 * checks none of it. Every refusal is a 404, so a message id does not reveal
 * whether the message exists.
 */
async function messageAccessGuard(req: Request): Promise<void> {
  const user = req.user;
  if (!user) throw new SdkApiError('unauthenticated', 'Missing authenticated principal.');
  const denied = SdkApiError.notFound('Conversation');

  const message = await repositories.messages.findById(pathParam(req, 'messageId'));
  if (!message || (message.visibleTo !== null && message.visibleTo !== user.id)) throw denied;

  const conversation = await repositories.conversations.findById(message.conversationId);
  if (!conversation) throw denied;

  const channel = await repositories.channels.findById(conversation.channelId);
  if (!channel || channel.workspaceId !== user.workspaceId) throw denied;
  if (
    channel.visibility === 'PRIVATE' &&
    !(await repositories.channelParticipants.isParticipant(conversation.channelId, user.id))
  ) {
    throw denied;
  }
}

/**
 * A canvas filed in a channel must be filed by one of its members. The product
 * route does not check; under /api/sdk it would let any caller post into any
 * channel whose id they hold.
 */
async function canvasChannelGuard(req: Request): Promise<void> {
  const user = req.user;
  if (!user) throw new SdkApiError('unauthenticated', 'Missing authenticated principal.');
  const channelId = (req.body as { channelId?: unknown } | undefined)?.channelId;
  if (typeof channelId !== 'string' || !channelId) return;
  if (!(await repositories.channelParticipants.isParticipant(channelId, user.id))) {
    throw SdkApiError.notFound('Channel');
  }
}

/**
 * The ticket exists in the caller's workspace and the caller can read it, by the
 * same rule the ticket table ACL applies to their queries. Otherwise 404.
 */
async function ticketVisibleGuard(req: Request): Promise<void> {
  const user = req.user;
  if (!user?.workspaceId || !user.role) {
    throw new SdkApiError('unauthenticated', 'Missing authenticated principal.');
  }
  const ticket = await db.ticket.findUnique({
    where: { id: pathParam(req, 'ticketId') },
    select: { id: true, workspaceId: true, channelId: true, projectId: true },
  });
  if (
    !ticket ||
    !(await canReadTicket(db, { userId: user.id, workspaceId: user.workspaceId, role: user.role }, ticket))
  ) {
    throw SdkApiError.notFound('Ticket');
  }
}

/**
 * Translate a legacy `{ success, data, error }` envelope into a bare payload.
 *
 * Some paths report failure with HTTP 200 and `success: false`, so this raises
 * rather than returning a body the caller would read as a result.
 */
function unwrapEnvelope(raw: unknown): unknown {
  const body = raw as { success?: boolean; data?: unknown; error?: string } | undefined;
  if (body?.success === false) {
    throw new SdkApiError('internal', body.error ?? 'The request failed.');
  }
  if (body && typeof body === 'object' && 'data' in body) return body.data;
  if (body && typeof body === 'object') {
    const { success: _success, ...rest } = body as Record<string, unknown>;
    return rest;
  }
  return body;
}

// API KEY AUTH (COMMENTED OUT) - principalOf was used to build AuthenticatedUser from authData
// For cookie-based auth, req.user is already set by authMiddleware
// function principalOf(authData: {
//   sub: string;
//   email: string;
//   name: string;
//   displayName?: string | null;
//   workspaceId: string;
//   role: string;
//   orgRole: string;
//   memberId: string;
// }): AuthenticatedUser {
//   return {
//     id: authData.sub,
//     // Not an OAuth-provider identity on this path. Controllers read id, email,
//     // and workspaceId; roles come from the verified principal.
//     googleId: '',
//     email: authData.email,
//     name: authData.name,
//     displayName: authData.displayName ?? null,
//     workspaceId: authData.workspaceId,
//     role: authData.role,
//     orgRole: authData.orgRole,
//     memberId: authData.memberId,
//     // Not the `isApiKeyUser` these controllers mean. That flag marks a key minted
//     // by `apiKeyService` — the environment key and scoped service keys — and two
//     // branches read it to skip the ACL check outright for an admin-role holder
//     // (middleware/acl.ts, middleware/auth.ts). An SDK key is a user acting as
//     // themselves and must get exactly a session's reach, so it stays false.
//     isApiKeyUser: false,
//   };
// }

function controllerError(status: number, body: unknown): SdkApiError {
  const payload = body as { error?: unknown; message?: unknown } | undefined;
  const message =
    (typeof payload?.message === 'string' && payload.message) ||
    (typeof payload?.error === 'string' && payload.error) ||
    'Request failed.';

  switch (status) {
    case 400:
    case 409:
    case 422:
      return new SdkApiError('validation_failed', message);
    case 401:
      return new SdkApiError('unauthenticated', message);
    case 403:
      return new SdkApiError('forbidden', message);
    case 404:
      return new SdkApiError('not_found', message);
    default:
      return new SdkApiError('internal', 'The handler failed.', { cause: body });
  }
}

/**
 * The connector failures an app can act on, in the SDK envelope. `details` is
 * part of the contract: the SDK reads `connector`, and `reason: 'write_tool'`
 * to name the refused tool.
 */
function connectorError(err: unknown): SdkApiError | undefined {
  if (err instanceof ConnectorNotConnectedError) {
    return new SdkApiError('not_connected', err.message, {
      details: { connector: err.connector },
      cause: err,
    });
  }
  if (err instanceof ConnectorWriteToolError) {
    return new SdkApiError('forbidden', err.message, {
      details: { connector: err.connector, tool: err.tool, reason: 'write_tool' },
      cause: err,
    });
  }
  if (err instanceof ConnectorNotFoundError) {
    return new SdkApiError('not_found', err.message, { cause: err });
  }
  if (err instanceof ConnectorRateLimitedError) {
    return new SdkApiError('rate_limited', err.message, { cause: err });
  }
  if (err instanceof ConnectorValidationError) {
    return new SdkApiError('validation_failed', err.message, { cause: err });
  }
  return undefined;
}

/**
 * A service failure message.
 *
 * `clawAgentService` throws plain `Error`s whose text names the upstream and the
 * status, which is worth keeping — but only the message, never the cause, since
 * the cause can carry the deployment's service credential.
 */
function serviceMessage(err: unknown): string {
  return err instanceof Error ? err.message : 'The upstream service failed.';
}

/** Parse fields that multipart delivered as JSON strings. */
function reviveJsonFields(body: unknown, fields: readonly string[]): unknown {
  if (!body || typeof body !== 'object') return body;
  const revived = { ...(body as Record<string, unknown>) };
  for (const field of fields) {
    const value = revived[field];
    if (typeof value !== 'string') continue;
    try {
      revived[field] = JSON.parse(value);
    } catch {
      // The controller owns validation and the eventual error response.
    }
  }
  return revived;
}
