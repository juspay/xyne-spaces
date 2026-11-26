import { Request, Response } from 'express';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import {
  AppCommandRepository,
  CommandType,
  CommandAccessibility } from '@/database/repositories/appCommandRepository';
import { db } from '@/database/client';
import { logger } from '@/utils/logger';
import { SsrfBlockedError, safeWebhookFetch } from '@/utils/ssrfGuard';
import { prepareAppWebhookDispatch } from '@/apps/core/appUrlResolver';
import { ConversationParticipation, MessageType } from '@xyne/shared';

/**
 * Insert a SYSTEM message visible only to `userId` explaining that a command or shortcut failed.
 *
 * - Thread context (conversationId provided): inserts directly into that thread.
 * - Channel context (no conversationId): creates a brand-new conversation so the
 *   notice appears in the channel feed — same pattern as "user_not_in_channel" notices.
 */
async function sendErrorNotice(opts: {
  channelId: string;
  conversationId: string | null | undefined;
  userId: string;       // viewer — who the message is visible to
  appUserId: string;    // sender — the app's bot user
  commandType: CommandType;
  identifier: string;   // commandName for COMMAND, callbackId for SHORTCUT
  reason: string;
  workspaceId: string;
}): Promise<void> {
  const { channelId, userId, appUserId, commandType, identifier, reason, workspaceId } = opts;
  const { conversationId } = opts;
  const now = Date.now();

  const label = commandType === CommandType.COMMAND ? `/${identifier}` : identifier;
  const content = `<p>⚠️ ${commandType === CommandType.COMMAND ? 'Command' : 'Shortcut'} <strong>${label}</strong> failed: ${reason}. Only you can see this message.</p>`;
  const metadataSubtype = commandType === CommandType.COMMAND ? 'command_error' : 'shortcut_error';

  try {
    if (conversationId) {
      await db.message.create({
        data: {
          conversationId,
          senderId: appUserId,
          content,
          msgType: MessageType.SYSTEM,
          hasAttachment: false,
          edited: false,
          isDeleted: false,
          showInChannel: false,
          isSent: true,
          visibleTo: userId,
          metadata: { messageSubtype: metadataSubtype, identifier },
          workspaceId } });
    } else {
      // Channel-level — create a new conversation so it appears in the channel feed
      const newConversationId = uuidv4();
      const messageId = uuidv4();

      await db.conversation.create({
        data: {
          conversationId: newConversationId,
          channelId,
          createdBy: appUserId,
          initialMessageId: messageId,
          lastActivityAt: new Date(now),
          replyCount: 0,
          pinned: false,
          createdAt: new Date(now),
          workspaceId } });

      await db.message.create({
        data: {
          messageId,
          conversationId: newConversationId,
          senderId: appUserId,
          content,
          msgType: MessageType.SYSTEM,
          hasAttachment: false,
          edited: false,
          isDeleted: false,
          showInChannel: false,
          isSent: true,
          createdAt: new Date(now),
          visibleTo: userId,
          metadata: { messageSubtype: metadataSubtype, identifier },
          workspaceId } });

      // Add the requesting user as conversation participant so they see the notice
      await db.conversationParticipant.create({
        data: {
          id: uuidv4(),
          conversationId: newConversationId,
          userId,
          participationType: ConversationParticipation.AUTHOR,
          isSubscribed: true,
          joinedAt: new Date(now),
          channelId,
          workspaceId } });
    }
  } catch (err) {
    logger.error('[COMMAND-DISPATCH] Failed to send error notice', err);
  }
}

const appCommandRepository = new AppCommandRepository();

const ChannelIdParamsSchema = z.object({
  channelId: z.string().min(1).trim() });

const DispatchCommandBodySchema = z.object({
  commandName: z.string().min(1).trim(),
  commandType: z.nativeEnum(CommandType),
  conversationId: z.string().nullable().optional(),
  // text for COMMAND type; messageText for SHORTCUT type — both accepted, text takes precedence
  text: z.string().optional(),
  messageText: z.string().optional(),
  // messageId is sent for message shortcuts so the app knows which message was acted on
  messageId: z.string().optional() });

// ── Message-shortcut helpers ────────────────────────────────────────────────

/**
 * Extract flowJSON from a message's HTML content.
 * Flow messages store their JSON payload in a `data-flow-json` attribute
 * on a wrapper div, e.g.:
 *   <div data-flow-json="{&quot;version&quot;:&quot;2.0&quot;,...}">Flow JSON</div>
 */
function extractFlowJSONFromHtml(html: string): Record<string, unknown> | null {
  const match = html.match(/data-flow-json="([^"]*)"/);
  if (!match) return null;
  try {
    const decoded = match[1]
      .replace(/&quot;/g, '"')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&#39;/g, "'")
      .replace(/&apos;/g, "'");
    return JSON.parse(decoded) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * Resolve user / group mentions from HTML back to the compact notation
 * used by commands (<userid:…> and <groupid:…>).
 *
 * Example HTML:
 *   <span data-user-id="cmq9…">@harimohan.sharma</span>
 * becomes:
 *   <userid:cmq9…>
 */
function resolveMentionsFromHtml(html: string): string {
  let text = html;
  // Step 1: Replace user mentions with safe placeholders (so they survive HTML stripping)
  text = text.replace(
    /<[^>]*data-user-id="([^"]*)"[^>]*>[^<]*<\/[^>]*>/g,
    '___XYNE_USER__$1___',
  );
  // Step 2: Replace group mentions with safe placeholders
  text = text.replace(
    /<[^>]*data-group-id="([^"]*)"[^>]*>[^<]*<\/[^>]*>/g,
    '___XYNE_GROUP__$1___',
  );
  // Step 3: Strip any remaining HTML tags
  text = text.replace(/<[^>]+>/g, '');
  // Step 4: Convert placeholders to the final mention notation
  text = text.replace(/___XYNE_USER__(.+?)___/g, '<userid:$1>');
  text = text.replace(/___XYNE_GROUP__(.+?)___/g, '<groupid:$1>');
  return text.trim();
}

export class CommandController {

  /**
   * POST /api/apps/channel/:channelId/command
   * Dispatch a command or shortcut — called when user triggers an action.
   * commandType is required in the body.
   *
   * Payload sent to app webhook:
   * {
   *   actionId: commandName,
   *   type: "command" | "shortcut" | "message_shortcut",
   *   values: { text: "..." },
   *   context: { channelId, conversationId, userId, flowJSON? }
   * }
   */
  dispatchCommand = async (req: Request, res: Response): Promise<void> => {
    const params = ChannelIdParamsSchema.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: 'Validation error', details: params.error.issues });
      return;
    }
    const body = DispatchCommandBodySchema.safeParse(req.body);
    if (!body.success) {
      res.status(400).json({ error: 'Validation error', details: body.error.issues });
      return;
    }

    const { channelId } = params.data;
    const { commandName, commandType, conversationId, messageId } = body.data;
    const text = body.data.text ?? body.data.messageText ?? '';
    const userId = req.user?.id ?? null;

    try {
      const match = await appCommandRepository.findCommandWithInstalledApp(
        channelId,
        commandName,
        commandType,
      );

      if (!match) {
        if (userId) {
          await sendErrorNotice({
            channelId,
            conversationId,
            userId,
            appUserId: userId,
            commandType,
            identifier: commandName,
            reason: `${commandType === CommandType.COMMAND ? 'command' : 'shortcut'} not found in this channel`,
            workspaceId: req.user!.workspaceId });
        }
        res.status(404).json({
          error: `${commandType === CommandType.COMMAND ? `Command "/${commandName}"` : `Shortcut "${commandName}"`} not found in this channel`,
          code: commandType === CommandType.COMMAND ? 'COMMAND_NOT_FOUND' : 'SHORTCUT_NOT_FOUND' });
        return;
      }

      if (!match.webhookUrl) {
        if (userId) {
          await sendErrorNotice({
            channelId,
            conversationId,
            userId,
            appUserId: match.appUserId,
            commandType,
            identifier: commandName,
            reason: 'app is not configured (no webhook URL set)',
            workspaceId: req.user!.workspaceId });
        }
        res.status(400).json({
          error: `App for ${commandType === CommandType.COMMAND ? `command "/${commandName}"` : `shortcut "${commandName}"`} has no webhook URL configured`,
          code: 'APP_NOT_CONFIGURED' });
        return;
      }

      // Determine the event type for the webhook header + payload
      let eventType: string;
      if (commandType === CommandType.SHORTCUT) {
        eventType =
          match.command.commandAccessibility === CommandAccessibility.MESSAGE
            ? 'message_shortcut'
            : 'shortcut';
      } else {
        eventType = 'command';
      }

      // Build payload values and context
      let payloadValues: Record<string, unknown> = { text };
      const contextPayload: Record<string, unknown> = {
        channelId,
        conversationId: conversationId ?? null,
        userId,
        messageId: messageId ?? null };

      // For message shortcuts, fetch the target message and either send its
      // flowJSON (if it is a flow message) or resolved text with mentions.
      if (
        commandType === CommandType.SHORTCUT &&
        messageId &&
        eventType === 'message_shortcut'
      ) {
        try {
          const message = await db.message.findUnique({
            where: { messageId },
            select: { content: true } });

          if (message?.content) {
            const flowJSON = extractFlowJSONFromHtml(message.content);
            if (flowJSON) {
              payloadValues = { text: '' };
              contextPayload.flowJSON = flowJSON;
            } else {
              payloadValues = { text: resolveMentionsFromHtml(message.content) };
              contextPayload.flowJSON = null;
            }
          } else {
            contextPayload.flowJSON = null;
          }
        } catch (err) {
          logger.error(
            '[COMMAND-DISPATCH] Failed to fetch message for shortcut',
            err,
          );
          contextPayload.flowJSON = null;
        }
      } else {
        // Commands and global shortcuts always get flowJSON: null
        contextPayload.flowJSON = null;
      }

      const payload = {
        actionId: commandName,
        type: eventType,
        values: payloadValues,
        context: contextPayload };

      logger.info('[COMMAND-DISPATCH] Calling app webhook', {
        appId: match.appId,
        commandName,
        commandType,
        channelId,
        eventType });

      // Resolve INTERNAL apps to their in-cluster pod URL; EXTERNAL apps go through the SSRF guard.
      const dispatchHeaders: Record<string, string> = {
        'Content-Type': 'application/json',
        'X-Xyne-Event': eventType };
      let dispatchUrl: string;
      let dispatchIsInternal = false;
      try {
        const prepared = await prepareAppWebhookDispatch(match.webhookUrl, dispatchHeaders);
        dispatchUrl = prepared.url;
        dispatchIsInternal = prepared.isInternal;
      } catch (err) {
        if (err instanceof SsrfBlockedError) {
          logger.warn('[COMMAND-DISPATCH] Blocked SSRF-unsafe webhook URL', {
            appId: match.appId,
            reason: err.message });
        } else {
          logger.error('[COMMAND-DISPATCH] Could not resolve app webhook URL', {
            appId: match.appId,
            error: err });
        }
        throw new Error('App webhook URL is not allowed');
      }

      // Internal = trusted-config pod URL (plain client); external = user-supplied,
      // so validate + pin the connection (rebinding-safe).
      const dispatchInit: RequestInit = {
        method: 'POST',
        headers: dispatchHeaders,
        body: JSON.stringify(payload),
        redirect: 'manual',
        signal: AbortSignal.timeout(30_000) };
      const appResponse = dispatchIsInternal
        ? await fetch(dispatchUrl, dispatchInit)
        : await safeWebhookFetch(dispatchUrl, dispatchInit);

      if (!appResponse.ok) {
        const errorBody = await appResponse.text().catch(() => 'unknown error');
        logger.error('[COMMAND-DISPATCH] App webhook returned error', {
          status: appResponse.status,
          body: errorBody.slice(0, 300) });
        if (userId) {
          await sendErrorNotice({
            channelId,
            conversationId,
            userId,
            appUserId: match.appUserId,
            commandType,
            identifier: commandName,
            reason: `the app returned an error (HTTP ${appResponse.status})`,
            workspaceId: req.user!.workspaceId });
        }
        res.status(502).json({ error: `App backend error ${appResponse.status}` });
        return;
      }

      res.status(200).json({
        message: commandType === CommandType.COMMAND ? 'Command dispatched' : 'Shortcut dispatched' });
    } catch (error) {
      if (error instanceof Error && error.name === 'TimeoutError') {
        if (userId) {
          await sendErrorNotice({
            channelId,
            conversationId,
            userId,
            appUserId: userId,
            commandType,
            identifier: commandName,
            reason: 'the app took too long to respond',
            workspaceId: req.user!.workspaceId });
        }
        res.status(504).json({ error: 'App backend timed out' });
        return;
      }
      logger.error('[COMMAND-DISPATCH] Unexpected error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  };
}
