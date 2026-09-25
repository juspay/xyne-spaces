import { Request, Response } from 'express';
import { logger } from '@/utils/logger';
import { repositories } from '@/database/repositories';
import { SsrfBlockedError, safeWebhookFetch } from '@/utils/ssrfGuard';
import { signWebhookPayload } from '@/apps/core/eventSubscriptionUtils';
import { prepareAppWebhookDispatch } from '@/apps/core/appUrlResolver';
import { decryptAsync } from '@/services/encryptionService';
import { SNS_CONFIRM_ACTION_ID } from './amazonSnsWebhookParser';
import { mintFlowToken, verifyFlowToken } from '@/apps/core/flowToken';
import { incomingWebhookController } from './incomingWebhookController';
import {
  validateActionRequest,
  validateFlowDefinition,
  validateAppActionResponse,
  formatValidationErrors,
} from '@xyne/shared';

/** Extract appId from the <div data-flow-appid="..."> tag embedded in message content */
function parseAppIdFromContent(content: string): string | null {
  const match = content.match(/data-flow-appid="([^"]*)"/);
  return match?.[1] ?? null;
}

export class FlowController {
  /**
   * Execute a flow action — synchronous, stateless.
   * POST /api/apps/flow/action
   *
   * The full current screen JSON (context.flowJSON) travels in the request body,
   * so this endpoint needs no DB read to process the action.
   * It validates, proxies to the app backend, validates the response, and returns it.
   */
  executeAction = async (req: Request, res: Response): Promise<void> => {
    // 1. Validate incoming ActionRequest
    const reqResult = validateActionRequest(req.body);
    if (!reqResult.success) {
      res.status(400).json({
        error: 'Invalid request',
        details: formatValidationErrors(reqResult),
      });
      return;
    }

    const { actionId, type, values, context } = reqResult.data;
    const { messageId, conversationId, flowJSON } = context;
    const userId = req.user?.id;

    // 2. Validate the flowJSON carried inside the context
    const flowResult = validateFlowDefinition(flowJSON);
    if (!flowResult.success) {
      res.status(400).json({
        error: 'Invalid flowJSON in context',
        details: formatValidationErrors(flowResult),
      });
      return;
    }

    // 2b. Amazon SNS confirmation is owned by the incoming-webhook controller,
    // not proxied: an incoming webhook has no outbound webhookUrl to proxy to.
    if (actionId === SNS_CONFIRM_ACTION_ID) {
      res.status(200).json(await incomingWebhookController.confirmSnsSubscription(values));
      return;
    }

    try {
      // 3. Resolve the appId — the decision that picks which app's signing secret
      // and webhook this action is dispatched to, so it must never come from the
      // client unverified.
      //
      // A token means the card was posted via chat.postEphemeral and was never
      // persisted: the signed token is the only record of its owning app, and it
      // is bound to this user and this messageId. Without one, this is an ordinary
      // persisted flow message and the appId is read back from its stored content,
      // exactly as before.
      let appId: string | null;
      if (context.token) {
        if (!userId) {
          res.status(401).json({ error: 'Unauthenticated' });
          return;
        }
        appId = verifyFlowToken(context.token, userId, messageId);
        if (!appId) {
          res.status(403).json({ error: 'Invalid or expired flow token' });
          return;
        }
      } else {
        const message = await repositories.messages.findById(messageId);
        if (!message) {
          res.status(404).json({ error: `Message not found: ${messageId}` });
          return;
        }
        appId = parseAppIdFromContent(message.content);
      }
      if (!appId) {
        res.status(400).json({ error: 'Message is not a flow UI message or missing appId' });
        return;
      }

      // 4. Look up the installed app to get its webhook/action URL. Multiple InstalledApps
      // rows can exist for the same appId (one per workspace) and only some carry a
      // webhookUrl, so scope the lookup to the user's workspace and require a configured
      // webhook.
      const workspaceId = req.user?.workspaceId;
      if (!workspaceId) {
        res.status(400).json({ error: 'Workspace not found for user' });
        return;
      }
      const installedApp = await repositories.installedApps.findFirst({
        where: {
          appId,
          webhookUrl: { not: null },
          AND: [{ webhookUrl: { not: '' } }],
          user: { workspaceId },
        },
      });
      if (!installedApp?.webhookUrl) {
        res.status(502).json({ error: `No webhook URL configured for app: ${appId}` });
        return;
      }

      // Flow actions are sent to the same app webhook as ordinary Spaces
      // events, so they must carry the same app-level HMAC. claw-auth treats
      // fields such as context.userId as authoritative; never forward the
      // action unsigned when signing material is missing.
      const app = await repositories.apps.findById(appId);
      if (!app?.signingSecret) {
        logger.error('[FLOW-ACTION] App signing secret is missing', { appId, messageId });
        res.status(502).json({ error: `No signing secret configured for app: ${appId}` });
        return;
      }

      // The token is Xyne's own capability, not the app's business — strip it so
      // it is neither logged nor stored downstream.
      let outboundFlowJSON = flowResult.data;
      if (context.token && flowResult.data.data) {
        const rest = { ...(flowResult.data.data as Record<string, unknown>) };
        delete rest['__xyneFlowToken'];
        outboundFlowJSON = { ...flowResult.data, data: rest };
      }

      // 5. Build the payload sent to the app backend
      const appPayload = {
        actionId,
        type,
        values,
        context: {
          flowJSON: outboundFlowJSON,
          messageId,
          conversationId,
          userId: userId ?? null,
        },
      };
      // Serialize exactly once: the HMAC must cover the same bytes fetch sends.
      const body = JSON.stringify(appPayload);
      const signature = signWebhookPayload(body, await decryptAsync(app.signingSecret));

      logger.info('[FLOW-ACTION] Calling app backend', { appId, actionId, type, messageId });

      // Resolve INTERNAL apps to their in-cluster pod URL; EXTERNAL apps go through the SSRF guard.
      const dispatchHeaders: Record<string, string> = {
        'Content-Type': 'application/json',
        'X-Xyne-Event': 'flow_action',
        'X-Xyne-Signature': signature,
        'X-Source': 'XyneSpaces',
      };
      let dispatchUrl: string;
      let dispatchIsInternal = false;
      try {
        const prepared = await prepareAppWebhookDispatch(installedApp.webhookUrl, dispatchHeaders);
        dispatchUrl = prepared.url;
        dispatchIsInternal = prepared.isInternal;
      } catch (err) {
        if (err instanceof SsrfBlockedError) {
          logger.warn('[FLOW-ACTION] Blocked SSRF-unsafe webhook URL', { appId, reason: err.message });
        } else {
          logger.error('[FLOW-ACTION] Could not resolve app webhook URL', { appId, error: err });
        }
        res.status(502).json({ error: 'App webhook URL is not allowed' });
        return;
      }

      // 6. Call the app backend synchronously. Internal = trusted-config pod URL
      // (plain client); external = user-supplied, so pin the connection (rebinding-safe).
      const dispatchInit: RequestInit = {
        method: 'POST',
        headers: dispatchHeaders,
        body,
        redirect: 'manual',
        signal: AbortSignal.timeout(30_000),
      };
      const appResponse = dispatchIsInternal
        ? await fetch(dispatchUrl, dispatchInit)
        : await safeWebhookFetch(dispatchUrl, dispatchInit);

      if (!appResponse.ok) {
        const text = await appResponse.text().catch(() => 'unknown error');
        logger.error('[FLOW-ACTION] App backend returned error', {
          status: appResponse.status,
          body: text.slice(0, 300),
        });
        res.status(502).json({
          error: `App backend error ${appResponse.status}`,
          details: [text.slice(0, 200)],
        });
        return;
      }

      const rawAppResponse: unknown = await appResponse.json();

      // 7. Validate the app backend's response
      const responseResult = validateAppActionResponse(rawAppResponse);
      if (!responseResult.success) {
        logger.error('[FLOW-ACTION] App backend returned invalid response', {
          errors: formatValidationErrors(responseResult),
        });
        res.status(502).json({
          error: 'App backend returned invalid response',
          details: formatValidationErrors(responseResult),
        });
        return;
      }

      // 8. If the response contains a new screen, validate it too
      const appData = responseResult.data;
      if (appData.type === 'open_screen' || appData.type === 'next_screen') {
        const screenResult = validateFlowDefinition(appData.flowJSON);
        if (!screenResult.success) {
          logger.error('[FLOW-ACTION] App backend returned malformed screen', {
            errors: formatValidationErrors(screenResult),
          });
          res.status(502).json({
            error: 'App backend returned malformed screen',
            details: formatValidationErrors(screenResult),
          });
          return;
        }

        // Re-mint for the screen the user is about to see. An ephemeral flow holds
        // no server state, so the next step's authority has to travel with it —
        // and a multi-step flow left open past the TTL would otherwise 403 on a
        // step the user has no way to retry.
        if (context.token && userId) {
          appData.flowJSON = {
            ...appData.flowJSON,
            data: {
              ...(appData.flowJSON.data ?? {}),
              __xyneFlowToken: mintFlowToken({ appId, userId, messageId }),
            },
          };
        }
      }

      logger.info('[FLOW-ACTION] Success', { appId, actionId, responseType: appData.type });
      res.status(200).json(appData);
    } catch (error) {
      if (error instanceof Error && error.name === 'TimeoutError') {
        logger.error('[FLOW-ACTION] App backend timed out', { messageId });
        res.status(504).json({ error: 'App backend timed out' });
        return;
      }
      logger.error('[FLOW-ACTION] Unexpected error', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  };
}
