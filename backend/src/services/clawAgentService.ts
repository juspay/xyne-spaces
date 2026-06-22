/**
 * Claw Agent Service
 * Encapsulates all interactions with the xyne-claw-auth backend.
 * Provides methods for running agents, managing conversations, handling actions,
 * downloading attachments, and listing agents in a channel.
 */
import { config } from '@/config/env';
import { logger } from '@/utils/logger';
import { db } from '@/database/client';
import type { Response } from 'express';
import { randomUUID } from 'crypto';
import { sendWebhookNotification } from '@/apps/core/eventSubscriptionUtils';
import { BaseAppEvent, AppEventType } from '@/apps/types';
import { decrypt } from '@/services/encryptionService';

export interface ChannelClawAgent {
  id: string;
  name: string;
  agentSlug: string;
  description: string | null;
}

export interface ClawRunRequest {
  userId: string;
  userName: string;
  userEmail: string;
  query: string;
  agentSlug: string;
  provider: string;
  conversationId: string;
  channelId: string;
  canvasIds?: string[];
  ticketIds?: string[];
  callIds?: string[];
  attachedContext?: Array<{
    type: string;
    id: string;
    title: string;
    threadId?: string;
    eventName?: string;
    eventCategory?: string;
    timestamp?: string;
    metadata?: Record<string, unknown>;
    relatedData?: Record<string, unknown>;
  }>;
  attachments?: Array<{
    id?: string;
    data?: string;
    mimeType: string;
    filename?: string;
    downloadUrl?: string;
    width?: number;
    height?: number;
  }>;
  messageAttachmentIds?: string[];
  webSearchEnabled: boolean;
  deepResearchEnabled: boolean;
  researchContext?: { type: string; id?: string; name: string } | null;
  createCanvasEnabled: boolean;
  sessionId?: string;
}

export interface ClawRunStreamResult {
  success: boolean;
  sessionId?: string;
  error?: string;
}

export interface AccessibleClawAgent {
  slug: string;
  name: string;
  color: string;
  description?: string;
  tools?: string[];
  skills?: string[];
  subagents?: string[];
}

export interface ClawConversationSummary {
  conversationId: string;
  title: string;
  messageCount: number;
  lastMessageAt: string;
}

export interface ClawMessagesResponse {
  success: boolean;
  data: unknown;
  toolInvocations?: unknown[];
  invocationsByMsgId?: Record<string, unknown[]>;
}

export interface ClawDebugArtifactBundle {
  conversationId: string;
  debugDir?: string;
  debugSession: Record<string, unknown> | null;
  debugEvents: Record<string, unknown>[] | null;
  runs: Array<{ fileName: string; data: Record<string, unknown> }>;
  subagents: Array<{ fileName: string; data: Record<string, unknown> }>;
}

export interface ClawActionApprovalResult {
  success: boolean;
  data?: { content: string };
  error?: string;
}

export interface ClawFeedbackPayload {
  traceId: string;
  value: 'LIKE' | 'DISLIKE';
}


// ============================================================================
// S2S (server-to-server) helpers for backend-initiated claw runs
// ============================================================================

export interface S2SClawAgent {
  id: string;
  slug: string;
  name: string;
  description: string;
  enabled: boolean;
  isDefault: boolean;
  color: string;
  spacesAppUserId?: string | null;
}

export interface S2SRunAgentRequest {
  agentSlug: string;
  task: string;
  userId: string;
  userName: string;
  userEmail: string;
  callbackUrl: string;
  conversationId?: string;
  channelId?: string;
  ticketIds?: string[];
  webSearchEnabled?: boolean;
}

export interface S2SRunAgentResponse {
  success: boolean;
  sessionId?: string;
  error?: string;
}

export interface ConversationInsight {
  reasoning: string | null;
  content: string | null;
  toolInvocations: unknown[];
}


// ============================================================================
// Internal helpers
// ============================================================================

function getClawBaseUrl(): string {
  return config.xyneClaw.authUrl;
}

function getS2SHeaders(): Record<string, string> {
  const s2sKey = config.xyneClaw.s2sKey;
  return s2sKey ? { 'x-s2s-key': s2sKey } : {};
}

function inferMimeType(filename: string | undefined, existingMimeType: string): string {
  if (existingMimeType && existingMimeType !== 'application/octet-stream') {
    return existingMimeType;
  }
  if (!filename) return 'application/octet-stream';
  const ext = filename.split('.').pop()?.toLowerCase();
  const mimeMap: Record<string, string> = {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
    svg: 'image/svg+xml',
    bmp: 'image/bmp',
    txt: 'text/plain',
    md: 'text/markdown',
    json: 'application/json',
    js: 'application/javascript',
    ts: 'application/typescript',
    py: 'text/x-python',
    html: 'text/html',
    css: 'text/css',
    pdf: 'application/pdf',
  };
  return mimeMap[ext || ''] || 'application/octet-stream';
}

function extractCookieHeader(req: { headers?: { cookie?: string } }): Record<string, string> {
  const cookie = req.headers?.cookie;
  return cookie ? { Cookie: cookie } : {};
}

function extractUserIdHeader(userId: string): Record<string, string> {
  return { 'x-user-id': userId };
}

// ============================================================================
// Channel agent listing
// ============================================================================

/**
 * List claw agents installed in a channel by inspecting the
 * channel participants that have claw-app installations.
 */
export async function listClawAgentsInChannel(channelId: string): Promise<ChannelClawAgent[]> {
  const clawPrefix = `${getClawBaseUrl()}/claw/`;

  // Find all installed apps with claw webhook URLs
  const installedApps = await db.installedApps.findMany({
    where: {
      webhookUrl: { startsWith: clawPrefix },
    },
    select: {
      userId: true,
      webhookUrl: true,
    },
  });

  if (!installedApps.length) return [];

  // Check which of these users are participants in the channel
  const channelParticipants = await db.channelParticipant.findMany({
    where: {
      channelId,
      userId: { in: installedApps.map((app) => app.userId) },
    },
    select: {
      userId: true,
    },
  });

  const participantUserIds = new Set(channelParticipants.map((p) => p.userId));

  // Get user details for participants
  const users = await db.user.findMany({
    where: {
      id: { in: Array.from(participantUserIds) },
    },
    select: {
      id: true,
      name: true,
    },
  });

  const userMap = new Map(users.map((u) => [u.id, u]));

  // Extract agent slugs from webhook URLs
  // Production URL format: https://spaces.xyne.juspay.net/claw/api/v1/webhook/{agent-slug}
  // The agent slug is the last segment of the URL path after /webhook/
  const agentSlugsFromApps: Array<{ userId: string; agentSlug: string }> = [];
  for (const app of installedApps) {
    if (!participantUserIds.has(app.userId)) continue;

    const url = app.webhookUrl;
    if (!url) continue;

    // Extract agent slug from the webhook URL
    // Try to match /webhook/{agent-slug} pattern first (production format)
    // Fallback to extracting the last path segment
    let agentSlug: string | null = null;

    const webhookMatch = url.match(/\/webhook\/([^/?#]+)/);
    if (webhookMatch) {
      agentSlug = webhookMatch[1] ?? null;
    } else {
      // Fallback: extract the last path segment after /claw/
      const pathAfterClaw = url.split('/claw/')[1];
      if (pathAfterClaw) {
        const segments = pathAfterClaw.split('/').filter((s) => s.length > 0);
        agentSlug = segments[segments.length - 1] ?? null;
      }
    }

    if (!agentSlug) continue;

    agentSlugsFromApps.push({ userId: app.userId, agentSlug });
  }

  const result: ChannelClawAgent[] = [];
  for (const { userId, agentSlug } of agentSlugsFromApps) {
    const user = userMap.get(userId);
    if (!user) continue;

    result.push({
      id: user.id,
      name: user.name,
      agentSlug,
      description: null,
    });
  }

  return result;
}

// ============================================================================
// Run / stream
// ============================================================================

/**
 * Process attachments for a claw run request:
 *   - Images → forwarded as-is for LLM vision
 *   - Text files → decoded and embedded into the task
 */
function processAttachmentsForRun(attachments?: ClawRunRequest['attachments']): {
  imageAttachments: Array<{ fileName: string; mimeType: string; data: string }>;
  textFileContents?: string;
  contextFiles: Array<{ path: string; content: string }>;
} {
  const imageAttachments: Array<{ fileName: string; mimeType: string; data: string }> = [];
  const contextFiles: Array<{ path: string; content: string }> = [];
  let textFileContents: string | undefined;

  if (!attachments?.length) {
    return { imageAttachments, contextFiles };
  }

  const withMime = attachments.map((att) => ({
    ...att,
    mimeType: inferMimeType(att.filename, att.mimeType),
  }));

  for (const att of withMime) {
    if (att.mimeType.startsWith('image/') && att.data) {
      imageAttachments.push({
        fileName: att.filename || 'attachment',
        mimeType: att.mimeType,
        data: att.data,
      });
    } else if (att.data) {
      let content = '';
      try {
        content = Buffer.from(att.data, 'base64').toString('utf-8');
      } catch {
        content = att.data;
      }
      if (!textFileContents) textFileContents = '';
      textFileContents += `\n\n--- FILE: ${att.filename || 'untitled'} ---\n\`\`\`\n${content.slice(0, 100000)}\n\`\`\`\n--- END OF ${att.filename || 'untitled'} ---\n`;
      contextFiles.push({ path: att.filename || 'file.txt', content });
    }
  }

  return { imageAttachments, textFileContents, contextFiles };
}

/**
 * Build the additional instructions block for the claw agent based on feature flags.
 */
function buildAdditionalInstructions(req: ClawRunRequest): string | undefined {
  const parts: string[] = [];

  if (req.researchContext) {
    parts.push(
      `You have access to the query-codebase and review-pull-request tools for codebase analysis. ` +
        `The user has selected "${req.researchContext.name}" ${req.researchContext.type} for research. ` +
        `Use these tools when the user asks about code, repositories, technical implementation, or needs a PR review.`
    );
  }
  if (req.createCanvasEnabled) {
    parts.push(
      `You MUST create a canvas document with your response using the spaces-create-canvas tool (available in the spaces subagent). ` +
        `After completing your analysis, call spaces-create-canvas with a descriptive title and your complete response formatted in markdown. ` +
        `After the tool returns, include the canvas URL in your response so the user can click on it. ` +
        `This is MANDATORY - the user requires the output in a canvas document with a clickable link.`
    );
  }
  if (req.webSearchEnabled) {
    parts.push(
      `The user has enabled web search. You have access to the web-search tool to find current information from the internet. ` +
        `Use it when the user asks about recent events, current data, or any topic requiring up-to-date information beyond your training data.`
    );
  }
  if (req.deepResearchEnabled) {
    parts.push(
      `The user has enabled deep research. You have access to the deep-research tool for comprehensive multi-step research. ` +
        `Use it for complex research questions that require thorough investigation, multiple sources, and a detailed report. ` +
        `This tool takes 1-10 minutes to complete and generates a comprehensive report.`
    );
  }

  return parts.length > 0 ? parts.join('\n\n') : undefined;
}

/**
 * Stream a claw agent run to the provided Express Response (SSE).
 *
 * An optional AbortSignal lets the caller tear down the upstream fetch when
 * the dashboard's SSE connection drops (or it explicitly cancels mid-run).
 * Without it, claw-auth would keep its own connection to claw open while
 * we hold the SSE socket on res — wasting work and leaving partial state
 * un-persisted because the `done` callback never reaches us.
 */
export async function runClawAgentStream(
  req: { headers?: { cookie?: string } },
  res: Response,
  request: ClawRunRequest,
  opts: { signal?: AbortSignal } = {}
): Promise<ClawRunStreamResult> {
  const clawAuthUrl = `${getClawBaseUrl()}/claw/api/v1/run/stream`;
  const clawConversationId = request.sessionId || `chat-${randomUUID()}`;

  logger.info(`[ClawAgentService] Streaming to ${clawAuthUrl}`, {
    userId: request.userId,
    agentSlug: request.agentSlug,
    conversationId: clawConversationId,
  });

  // Process attachments
  const { imageAttachments, textFileContents, contextFiles } = processAttachmentsForRun(
    request.attachments
  );

  let enhancedTask = request.query;
  if (textFileContents) {
    enhancedTask = `User query: ${request.query}\n\nThe user has attached the following files:\n${textFileContents}`;
  }

  const additionalInstructions = buildAdditionalInstructions(request);

  const payload: Record<string, unknown> = {
    userId: request.userId,
    userName: request.userName,
    userEmail: request.userEmail,
    task: enhancedTask,
    agentSlug: request.agentSlug,
    provider: request.provider,
    conversationId: clawConversationId,
    channelId: request.channelId,
    ...(request.canvasIds?.length && { canvasIds: request.canvasIds }),
    ...(request.ticketIds?.length && { ticketIds: request.ticketIds }),
    ...(request.callIds?.length && { callIds: request.callIds }),
    ...(request.attachedContext?.length && { attachedContext: request.attachedContext }),
    ...(imageAttachments.length > 0 && {
      attachments: imageAttachments,
    }),
    ...(contextFiles.length > 0 && { contextFiles }),
    ...(request.webSearchEnabled && { webSearchEnabled: true }),
    ...(request.deepResearchEnabled && { deepResearchEnabled: true }),
    ...(request.researchContext && { researchContext: request.researchContext }),
    agentConfig: {
      webSearchEnabled: String(request.webSearchEnabled),
      deepResearchEnabled: String(request.deepResearchEnabled),
      ...(config.xyneAiExtended.url && { XYNE_AI_EXTENDED_URL: config.xyneAiExtended.url }),
      ...(request.conversationId && { SPACES_CONVERSATION_ID: request.conversationId }),
    },
    ...(additionalInstructions && { additionalInstructions }),
  };

  const cookieHeader = extractCookieHeader(req);
  const response = await fetch(clawAuthUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
      ...cookieHeader,
    },
    body: JSON.stringify(payload),
    ...(opts.signal ? { signal: opts.signal } : {}),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`xyne-claw returned ${response.status}: ${errorText}`);
  }

  if (!response.body) {
    throw new Error('No response body from xyne-claw');
  }

  // Forward SSE events
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let currentEventType = '';
  let eventCount = 0;

  try {
    while (true) {
      if (opts.signal?.aborted) break;
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value, { stream: true });
      buffer += chunk;
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) {
          currentEventType = '';
          continue;
        }

        if (trimmed.startsWith('event:')) {
          currentEventType = trimmed.slice(6).trim();
          continue;
        } else if (trimmed.startsWith('data:')) {
          const data = trimmed.slice(5).trim();
          try {
            const parsed = JSON.parse(data);
            eventCount++;

            const eventType = currentEventType;
            if (eventType === 'meta') {
              logger.debug('[ClawAgentService] SSE meta:', parsed);
            } else if (eventType === 'run') {
              res.write(
                `data: ${JSON.stringify({
                  type: 'start',
                  sessionId: clawConversationId,
                  traceId: parsed.sessionId,
                })}\n\n`
              );
              if (typeof (res as any).flush === 'function') (res as any).flush();
            } else if (eventType === 'delta') {
              res.write(
                `data: ${JSON.stringify({
                  type: 'delta',
                  content: parsed.content || parsed.delta,
                })}\n\n`
              );
              if (typeof (res as any).flush === 'function') (res as any).flush();
            } else if (eventType === 'reasoning') {
              res.write(
                `data: ${JSON.stringify({
                  type: 'reasoning_delta',
                  reasoningDelta: parsed.delta || parsed.reasoningDelta,
                })}\n\n`
              );
              if (typeof (res as any).flush === 'function') (res as any).flush();
            } else if (eventType === 'invocation') {
              res.write(
                `data: ${JSON.stringify({
                  type: 'tool_invocation',
                  toolInvocation: parsed,
                })}\n\n`
              );
              if (typeof (res as any).flush === 'function') (res as any).flush();
            } else if (eventType === 'attachment') {
              res.write(
                `data: ${JSON.stringify({
                  type: 'attachment',
                  attachment: parsed,
                })}\n\n`
              );
              if (typeof (res as any).flush === 'function') (res as any).flush();
            } else if (eventType === 'debug') {
              res.write(
                `data: ${JSON.stringify({
                  type: 'debug_event',
                  debugEvent: parsed.debugEvent,
                })}\n\n`
              );
              if (typeof (res as any).flush === 'function') (res as any).flush();
            } else if (eventType === 'debug_artifacts_ready') {
              res.write(
                `data: ${JSON.stringify({
                  type: 'debug_artifacts_ready',
                  sessionId: parsed.sessionId,
                  conversationId: parsed.conversationId || clawConversationId,
                })}\n\n`
              );
              if (typeof (res as any).flush === 'function') (res as any).flush();
            } else if (eventType === 'done') {
              res.write(
                `data: ${JSON.stringify({
                  type: 'complete',
                  sessionId: clawConversationId,
                  content: parsed.content,
                  status: parsed.status,
                  ...(parsed.attachments?.length && { attachments: parsed.attachments }),
                  ...(parsed.pendingActions?.length && { pendingActions: parsed.pendingActions }),
                })}\n\n`
              );
              if (typeof (res as any).flush === 'function') (res as any).flush();
            } else if (eventType === 'error') {
              res.write(
                `data: ${JSON.stringify({
                  type: 'error',
                  error: parsed.error || 'Unknown error',
                })}\n\n`
              );
              if (typeof (res as any).flush === 'function') (res as any).flush();
            } else {
              logger.warn(`[ClawAgentService] Unknown SSE event type: ${eventType}`);
            }
          } catch (e) {
            logger.warn('[ClawAgentService] Failed to parse SSE data:', data);
          }
        }
      }
    }
  } catch (err) {
    if (opts.signal?.aborted || (err instanceof Error && err.name === 'AbortError')) {
      logger.info(`[ClawAgentService] Stream aborted by caller (events=${eventCount})`);
      return { success: false, sessionId: clawConversationId, error: 'aborted' };
    }
    throw err;
  } finally {
    try { reader.releaseLock(); } catch { /* already released */ }
  }

  logger.info(`[ClawAgentService] Stream complete, events=${eventCount}`);
  return { success: true, sessionId: clawConversationId };
}

/**
 * Cancel an in-flight claw agent run by sessionId.
 *
 * Forwards to claw-auth's `/run/stream/cancel`, which validates ownership and
 * calls claw's `/run/:sessionId/cancel`. Claw aborts the run's AbortController,
 * the agent loop throws RunCancelledError, and the resulting `done` frame with
 * status="cancelled" carries the partial assistant text + tool invocations so
 * the message store gets the in-flight state instead of nothing.
 */
export async function cancelClawAgentRun(
  req: { headers?: { cookie?: string } },
  userId: string,
  sessionId: string
): Promise<{ success: boolean; status: string; error?: string }> {
  const url = `${getClawBaseUrl()}/claw/api/v1/run/stream/cancel`;
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...extractUserIdHeader(userId),
        ...extractCookieHeader(req),
      },
      body: JSON.stringify({ sessionId }),
    });
    const json = (await response.json().catch(() => ({}))) as {
      success?: boolean;
      data?: { status?: string };
      error?: string;
    };
    if (!response.ok || !json.success) {
      const error = json.error ?? `Cancel failed: HTTP ${response.status}`;
      logger.warn(`[ClawAgentService] cancelClawAgentRun ${sessionId}: ${error}`);
      return { success: false, status: 'unknown', error };
    }
    return { success: true, status: json.data?.status ?? 'cancelled' };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error(`[ClawAgentService] cancelClawAgentRun ${sessionId} failed: ${msg}`);
    return { success: false, status: 'unknown', error: msg };
  }
}

// ============================================================================
// Conversations
// ============================================================================

// Raw agent structure from xyne-claw-auth API
interface RawClawAgent {
  slug: string;
  name: string;
  color?: string;
  description?: string;
  config?: {
    tools?: {
      subagents?: string[];
    };
  };
  tools?: Array<{
    id: string;
    agentId: string;
    toolId: string;
    permission: string;
    tool?: { name: string; slug?: string; description?: string; source?: string };
  }>;
  skills?: Array<{
    id: string;
    agentId: string;
    skillId: string;
    skill?: { name: string; slug?: string; label?: string };
  }>;
}

export async function listAccessibleClawAgents(req: {
  headers?: { cookie?: string };
  userId: string;
}): Promise<{ success: boolean; data: AccessibleClawAgent[] }> {
  const url = `${getClawBaseUrl()}/claw/api/v1/agents?userId=${encodeURIComponent(req.userId)}`;
  const response = await fetch(url, {
    headers: {
      ...extractUserIdHeader(req.userId),
      ...extractCookieHeader(req),
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    logger.error(`[ClawAgentService] listAccessibleAgents failed: ${response.status} ${errorText}`);
    throw new Error('Failed to fetch accessible agents');
  }

  const result = (await response.json()) as { success: boolean; data: RawClawAgent[] };

  // Transform raw agent data to extract tool/skill/subagent names from nested structures
  const transformedData: AccessibleClawAgent[] = result.data.map((agent) => {
    return {
      slug: agent.slug,
      name: agent.name,
      color: agent.color || '#6366f1',
      description: agent.description,
      // Extract tool slugs from nested AgentTool -> Tool structure (matches xyne-claw dashboard)
      tools: agent.tools
        ?.map((at) => at.tool?.slug || at.tool?.name || at.toolId)
        .filter((n): n is string => Boolean(n)),
      // Extract skill names from nested AgentSkill -> Skill structure
      skills: agent.skills
        ?.map((as) => as.skill?.name || as.skill?.label || as.skillId)
        .filter((n): n is string => Boolean(n)),
      // Subagents are stored in agent.config.tools.subagents (matches xyne-claw dashboard)
      subagents: agent.config?.tools?.subagents ?? [],
    };
  });

  return { success: true, data: transformedData };
}

export async function listClawConversations(
  req: { headers?: { cookie?: string }; userId: string },
  agentSlug?: string
): Promise<{ success: boolean; data: ClawConversationSummary[] }> {
  const slug = agentSlug || 'ask-ai';
  const url = `${getClawBaseUrl()}/claw/api/v1/agent-chat/${encodeURIComponent(slug)}/conversations?userId=${encodeURIComponent(req.userId)}`;
  const response = await fetch(url, {
    headers: {
      ...extractUserIdHeader(req.userId),
      ...extractCookieHeader(req),
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    logger.error(`[ClawAgentService] listConversations failed: ${response.status} ${errorText}`);
    throw new Error('Failed to fetch conversations');
  }

  return (await response.json()) as { success: boolean; data: ClawConversationSummary[] };
}

export async function getClawConversationMessages(
  req: { headers?: { cookie?: string }; userId: string },
  convId: string,
  agentSlug?: string
): Promise<ClawMessagesResponse> {
  const slug = agentSlug || 'ask-ai';
  const url = `${getClawBaseUrl()}/claw/api/v1/agent-chat/${encodeURIComponent(slug)}/chat/${encodeURIComponent(convId)}/messages`;
  const response = await fetch(url, {
    headers: {
      ...extractUserIdHeader(req.userId),
      ...extractCookieHeader(req),
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    logger.error(`[ClawAgentService] getMessages failed: ${response.status} ${errorText}`);
    throw new Error('Failed to fetch messages');
  }

  return (await response.json()) as ClawMessagesResponse;
}

export async function deleteClawConversation(
  req: { headers?: { cookie?: string }; userId: string },
  convId: string,
  agentSlug?: string
): Promise<{ success: boolean; data: { deleted: number } }> {
  const slug = agentSlug || 'ask-ai';
  const url = `${getClawBaseUrl()}/claw/api/v1/agent-chat/${encodeURIComponent(slug)}/chat/${encodeURIComponent(convId)}`;
  const response = await fetch(url, {
    method: 'DELETE',
    headers: {
      ...extractUserIdHeader(req.userId),
      ...extractCookieHeader(req),
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    logger.error(`[ClawAgentService] deleteConversation failed: ${response.status} ${errorText}`);
    throw new Error('Failed to delete conversation');
  }

  return (await response.json()) as { success: boolean; data: { deleted: number } };
}

export async function getClawDebugArtifacts(
  req: { headers?: { cookie?: string }; userId: string },
  convId: string,
  agentSlug?: string
): Promise<{ success: boolean; data: ClawDebugArtifactBundle }> {
  const slug = agentSlug || 'ask-ai';
  const url = `${getClawBaseUrl()}/claw/api/v1/agent-chat/${encodeURIComponent(slug)}/chat/${encodeURIComponent(convId)}/debug`;
  const response = await fetch(url, {
    headers: {
      ...extractUserIdHeader(req.userId),
      ...extractCookieHeader(req),
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    logger.error(`[ClawAgentService] getDebugArtifacts failed: ${response.status} ${errorText}`);
    throw new Error(
      response.status === 404 ? 'Debug artifacts not found' : 'Failed to fetch debug artifacts'
    );
  }

  return (await response.json()) as { success: boolean; data: ClawDebugArtifactBundle };
}

// ============================================================================
// Actions
// ============================================================================

export async function approveClawAction(
  req: { headers?: { cookie?: string }; userId: string },
  payload: {
    sessionId?: string;
    actionId?: string;
    approved?: boolean;
    params?: Record<string, unknown>;
    serverType?: string;
    tool?: string;
    signature?: string;
  }
): Promise<ClawActionApprovalResult> {
  if (!payload.approved) {
    return { success: true, data: { content: '' } };
  }

  const url = `${getClawBaseUrl()}/claw/api/v1/agent-chat/ask-ai/chat/approve-action`;
  const pendingAction: Record<string, unknown> = {
    serverType: payload.serverType || 'xyne-spaces',
    tool: payload.tool || 'unknown',
    params: payload.params || {},
    userId: req.userId,
    signature: payload.signature || '',
  };

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...extractUserIdHeader(req.userId),
      ...extractCookieHeader(req),
    },
    body: JSON.stringify({ pendingAction }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    logger.error(`[ClawAgentService] approve-action failed: ${response.status} ${errorText}`);

    let errorMessage = 'Failed to execute action';
    try {
      const upstreamError = JSON.parse(errorText) as { error?: string; message?: string };
      errorMessage = upstreamError.error ?? upstreamError.message ?? errorText;
    } catch {
      errorMessage = errorText.length > 200 ? `${errorText.slice(0, 200)}...` : errorText;
    }

    throw new Error(errorMessage);
  }

  return (await response.json()) as ClawActionApprovalResult;
}

// ============================================================================
// Attachments
// ============================================================================

export async function downloadClawAttachment(
  req: { headers?: { cookie?: string }; userId: string },
  attachmentId: string
): Promise<{
  buffer: Buffer;
  contentType: string;
  contentDisposition: string | null;
  contentLength: string | null;
}> {
  const url = `${getClawBaseUrl()}/claw/api/v1/agent-chat/attachments/${attachmentId}/download`;
  logger.info(`[ClawAgentService] Downloading attachment: ${attachmentId}`);

  const response = await fetch(url, {
    headers: {
      ...extractUserIdHeader(req.userId),
      ...extractCookieHeader(req),
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    logger.error(`[ClawAgentService] Download failed: ${response.status} ${errorText}`);
    throw new Error('Failed to download attachment');
  }

  const arrayBuffer = await response.arrayBuffer();
  return {
    buffer: Buffer.from(arrayBuffer),
    contentType: response.headers.get('content-type') || 'application/octet-stream',
    contentDisposition: response.headers.get('content-disposition'),
    contentLength: response.headers.get('content-length'),
  };
}

/** List enabled Claw agents via S2S (used by email auto-draft agent picker). */
export async function listS2SClawAgents(): Promise<S2SClawAgent[]> {
  const url = `${getClawBaseUrl()}/claw/api/v1/agents`;
  let res: globalThis.Response;
  try {
    res = await fetch(url, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json', ...getS2SHeaders() },
      signal: AbortSignal.timeout(15_000),
    });
  } catch (err) {
    throw new Error(
      `[ClawAgentService] listS2SClawAgents: failed to reach claw-auth at ${url}: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  if (!res.ok) {
    const body = await safeReadText(res);
    throw new Error(`[ClawAgentService] listS2SClawAgents: HTTP ${res.status} — ${body}`);
  }

  const json = (await res.json()) as { success: boolean; data?: S2SClawAgent[]; error?: string };
  if (!json.success || !Array.isArray(json.data)) {
    throw new Error(
      `[ClawAgentService] listS2SClawAgents: bad response shape — ${JSON.stringify(json)}`
    );
  }
  return json.data.filter((a) => a.enabled);
}

/** Run a claw agent via S2S (non-streaming, callback-based). Mirrors legacy clawClient.runAgent(). */
export async function runS2SClawAgent(req: S2SRunAgentRequest): Promise<S2SRunAgentResponse> {
  const url = config.xyneClaw.webhookUrl;
  const sessionId = randomUUID();
  let res: globalThis.Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...getS2SHeaders() },
      body: JSON.stringify({
        s2sKey: config.xyneClaw.s2sKey,
        sessionId,
        agentSlug: req.agentSlug,
        task: req.task,
        userId: req.userId,
        callbackUrl: req.callbackUrl,
        ...(req.conversationId ? { conversationId: req.conversationId } : {}),
        ...(req.channelId ? { channelId: req.channelId } : {}),
      }),
      signal: AbortSignal.timeout(30_000),
    });
  } catch (err) {
    throw new Error(
      `[ClawAgentService] runS2SClawAgent: failed to reach claw-auth webhook at ${url}: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  const json = (await res.json().catch(() => ({}))) as S2SRunAgentResponse;
  if (!res.ok || !json.success) {
    throw new Error(
      `[ClawAgentService] runS2SClawAgent: webhook rejected the run (HTTP ${res.status}, error=${json.error ?? 'unknown'})`
    );
  }
  return { success: true, sessionId: json.sessionId ?? sessionId };
}

export interface AppMentionAgentRequest {
  agentSlug: string;
  task: string;
  userId: string;
  userName: string;
  conversationId: string;
  channelId: string;
  resultForwardUrl: string;
}

export async function runClawAgent(
  req: AppMentionAgentRequest,
): Promise<{ dispatched: boolean }> {
  const installedApp = await db.installedApps.findFirst({
    where: { webhookUrl: { endsWith: `/webhook/${req.agentSlug}` } },
    select: { webhookUrl: true, signingSecret: true },
  });
  if (!installedApp?.webhookUrl) {
    logger.warn('[ClawAgentService] runClawAgent: no installed-app webhook for agent', {
      agentSlug: req.agentSlug,
    });
    return { dispatched: false };
  }

  const event: BaseAppEvent = {
    eventType: AppEventType.APP_MENTION,
    payload: {
      conversationId: req.conversationId,
      messageId: randomUUID(),
      content: req.task,
      cleanContent: req.task,
      createdAt: Date.now(),
      userId: req.userId,
      senderName: req.userName,
      channelId: req.channelId,
      metadata: { resultForwardUrl: req.resultForwardUrl },
    },
    timestamp: new Date().toISOString(),
  };
  await sendWebhookNotification(installedApp.webhookUrl, event, decrypt(installedApp.signingSecret));
  return { dispatched: true };
}

/** Fetch the latest assistant reasoning and tool invocations from a claw conversation. Used by email auto-draft. */
export async function getConversationInsight(params: {
  agentSlug: string;
  conversationId: string;
  userId: string;
}): Promise<ConversationInsight> {
  const { agentSlug, conversationId, userId } = params;
  const url = `${getClawBaseUrl()}/claw/api/v1/agent-chat/${encodeURIComponent(agentSlug)}/chat/${encodeURIComponent(conversationId)}/messages`;
  let res: globalThis.Response;
  try {
    res = await fetch(url, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json', 'x-user-id': userId, ...getS2SHeaders() },
      signal: AbortSignal.timeout(15_000),
    });
  } catch (err) {
    throw new Error(
      `[ClawAgentService] getConversationInsight: failed to reach claw-auth at ${url}: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  if (!res.ok) {
    const body = await safeReadText(res);
    throw new Error(`[ClawAgentService] getConversationInsight: HTTP ${res.status} — ${body}`);
  }

  const json = (await res.json()) as {
    success?: boolean;
    data?: Array<{ id: string; role: string; reasoning?: string | null; content?: string | null }>;
    invocationsByMsgId?: Record<string, unknown[]>;
  };
  const messages = Array.isArray(json.data) ? json.data : [];
  const lastAssistant = [...messages].reverse().find((m) => m.role === 'assistant');
  const reasoning =
    lastAssistant?.reasoning && lastAssistant.reasoning.trim() ? lastAssistant.reasoning : null;
  const content =
    lastAssistant?.content && lastAssistant.content.trim() ? lastAssistant.content : null;
  const toolInvocations =
    lastAssistant && Array.isArray(json.invocationsByMsgId?.[lastAssistant.id])
      ? (json.invocationsByMsgId![lastAssistant.id] as unknown[])
      : [];
  return { reasoning, content, toolInvocations };
}

async function safeReadText(res: globalThis.Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return '<unreadable>';
  }
}
