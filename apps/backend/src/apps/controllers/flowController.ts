import { Request, Response } from 'express';
import { logger } from '@/utils/logger';
import { repositories } from '@/database/repositories';
import { SsrfBlockedError } from '@/utils/ssrfGuard';
import { signWebhookPayload } from '@/apps/core/eventSubscriptionUtils';
import { prepareAppWebhookDispatch } from '@/apps/core/appUrlResolver';
import { decrypt } from '@/services/encryptionService';
import { SNS_CONFIRM_ACTION_ID } from './amazonSnsWebhookParser';
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
      // 3. Look up the message to get the appId (stored in <xyne-flow> content tag)
      const message = await repositories.messages.findById(messageId);
      if (!message) {
        res.status(404).json({ error: `Message not found: ${messageId}` });
        return;
      }

      const appId = parseAppIdFromContent(message.content);
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

      // 5. Build the payload sent to the app backend
      const appPayload = {
        actionId,
        type,
        values,
        context: {
          flowJSON: flowResult.data,
          messageId,
          conversationId,
          userId: userId ?? null,
        },
      };
      // Serialize exactly once: the HMAC must cover the same bytes fetch sends.
      const body = JSON.stringify(appPayload);
      const signature = signWebhookPayload(body, decrypt(app.signingSecret));

      logger.info('[FLOW-ACTION] Calling app backend', { appId, actionId, type, messageId });

      // Resolve INTERNAL apps to their in-cluster pod URL; EXTERNAL apps go through the SSRF guard.
      const dispatchHeaders: Record<string, string> = {
        'Content-Type': 'application/json',
        'X-Xyne-Event': 'flow_action',
        'X-Xyne-Signature': signature,
        'X-Source': 'XyneSpaces',
      };
      let dispatchUrl: string;
      try {
        const prepared = await prepareAppWebhookDispatch(installedApp.webhookUrl, dispatchHeaders);
        dispatchUrl = prepared.url;
      } catch (err) {
        if (err instanceof SsrfBlockedError) {
          logger.warn('[FLOW-ACTION] Blocked SSRF-unsafe webhook URL', { appId, reason: err.message });
        } else {
          logger.error('[FLOW-ACTION] Could not resolve app webhook URL', { appId, error: err });
        }
        res.status(502).json({ error: 'App webhook URL is not allowed' });
        return;
      }

      // 6. Call the app backend synchronously.
      const appResponse = await fetch(dispatchUrl, {
        method: 'POST',
        headers: dispatchHeaders,
        body,
        redirect: 'manual',
        signal: AbortSignal.timeout(30_000),
      });

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
