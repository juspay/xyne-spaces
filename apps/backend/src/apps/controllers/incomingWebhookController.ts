import crypto from 'node:crypto';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { repositories } from '@/database/repositories';
import {
  processSlackIncoming,
  processSentinelIncoming,
  processAmazonSnsIncoming,
  processPingdomIncoming,
  processGcpIncoming,
  processHubspotIncoming } from '@/bypassAcl/appServices';
import { logger } from '@/utils/logger';
import { decrypt } from '@/services/encryptionService';
import { AppIncomingWebhookType } from '@xyne/shared';
import { assertWebhookUrlSafe, safeWebhookFetch, SsrfBlockedError } from '@/utils/ssrfGuard';
import {
  parseSnsEnvelope } from './amazonSnsWebhookParser';
import {   parsePingdomPayload } from './pingdomWebhookParser';
import {   parseGcpPayload } from './gcpWebhookParser';
import { parseHubspotPayload } from './hubspotWebhookParser';

type IncomingWebhookType = AppIncomingWebhookType;
type StoredIncomingWebhook = Prisma.AppIncomingWebhookGetPayload<{}>;

const IncomingWebhookParamsSchema = z.object({
  workspaceId: z.string().min(1).trim(),
  appId: z.string().min(1).trim(),
  secret: z.string().min(1).trim() });

export type WebhookContext = {
  workspaceId: string;
  appId: string;
  installedApp: NonNullable<Awaited<ReturnType<typeof repositories.installedApps.findFirst>>>;
  channelId: string;
  webhook: StoredIncomingWebhook;
  body: unknown;
};

class IncomingWebhookController {
  buildIncomingWebhookUrl = (
    workspaceId: string | undefined,
    installedAppId: string,
    secret: string,
    type: IncomingWebhookType = AppIncomingWebhookType.SLACK,
  ): string => {
    const safeWorkspaceId = workspaceId ?? '';
    if (type === AppIncomingWebhookType.SENTINELONE) {
      return `/api/apps/webhooks/sentinel/${safeWorkspaceId}/${installedAppId}/${secret}`;
    }
    if (type === AppIncomingWebhookType.AMAZON_SNS) {
      return `/api/apps/webhooks/sns/${safeWorkspaceId}/${installedAppId}/${secret}`;
    }
    if (type === AppIncomingWebhookType.PINGDOM) {
      return `/api/apps/webhooks/pingdom/${safeWorkspaceId}/${installedAppId}/${secret}`;
    }
    if (type === AppIncomingWebhookType.GCP) {
      return `/api/apps/webhooks/gcp/${safeWorkspaceId}/${installedAppId}/${secret}`;
    }
    if (type === AppIncomingWebhookType.HUBSPOT) {
      return `/api/apps/webhooks/hubspot/${safeWorkspaceId}/${installedAppId}/${secret}`;
    }

    return `/api/apps/webhooks/${safeWorkspaceId}/${installedAppId}/${secret}`;
  };

  private async parseBody(
    req: Request,
    workspaceId: string,
    appId: string,
  ): Promise<unknown | null> {
    if (Buffer.isBuffer(req.body)) {
      try {
        return JSON.parse(req.body.toString('utf8'));
      } catch (error) {
        logger.warn('[Incoming-Webhook] Failed to parse buffered webhook body', {
          workspaceId,
          appId,
          error });
        return null;
      }
    }

    // Amazon SNS posts JSON under `Content-Type: text/plain`, so its route parses
    // the body with express.text() and hands us a raw string.
    if (typeof req.body === 'string') {
      try {
        return JSON.parse(req.body);
      } catch (error) {
        logger.warn('[Incoming-Webhook] Failed to parse text webhook body', {
          workspaceId,
          appId,
          error });
        return null;
      }
    }

    return req.body;
  }

  private async resolveWebhookContext(
    req: Request,
    expectedType: IncomingWebhookType,
  ): Promise<WebhookContext | null> {
    const paramsResult = IncomingWebhookParamsSchema.safeParse(req.params);
    if (!paramsResult.success) {
      logger.warn('[Incoming-Webhook] Invalid incoming webhook params', {
        issues: paramsResult.error.issues,
        expectedType });
      return null;
    }

    const { workspaceId, appId, secret } = paramsResult.data;
    const body = await this.parseBody(req, workspaceId, appId);
    if (body === null) {
      return null;
    }

    const installedApp = await repositories.installedApps.findFirst({
      where: { id: appId } });
    if (!installedApp) {
      return null;
    }

    const botUser = await repositories.users.findById(installedApp.userId);
    if (!botUser || botUser.workspaceId !== workspaceId) {
      return null;
    }

    const activeWebhooks = await repositories.incomingWebhooks.findActiveByInstalledAppId(installedApp.id);

    let matchedWebhook: typeof activeWebhooks[number] | null = null;
    const secretBuffer = Buffer.from(secret, 'utf8');

    for (const webhook of activeWebhooks) {
      try {
        const decryptedSecret = decrypt(webhook.secret);
        const storedBuffer = Buffer.from(decryptedSecret, 'utf8');
        if (
          storedBuffer.length === secretBuffer.length &&
          crypto.timingSafeEqual(storedBuffer, secretBuffer)
        ) {
          matchedWebhook = webhook;
          break;
        }
      } catch (error) {
        logger.warn('[Incoming-Webhook] Failed to decrypt webhook secret during incoming validation', {
          webhookId: webhook.id,
          installedAppId: installedApp.id,
          error });
      }
    }

    if (!matchedWebhook) {
      return null;
    }

    const webhookType =
      (matchedWebhook.type as IncomingWebhookType | undefined) ?? AppIncomingWebhookType.SLACK;
    if (webhookType !== expectedType) {
      logger.warn('[Incoming-Webhook] Webhook type mismatch', {
        webhookId: matchedWebhook.id,
        installedAppId: installedApp.id,
        expectedType,
        actualType: webhookType });
      return null;
    }

    const { channelId } = matchedWebhook;
    const isParticipant = await repositories.channelParticipants.isParticipant(
      channelId,
      installedApp.userId,
    );
    if (!isParticipant) {
      return null;
    }

    return {
      workspaceId,
      appId,
      installedApp,
      channelId,
      webhook: matchedWebhook,
      body };
  }

  handleIncoming = async (req: Request, res: Response): Promise<void> => {
    try {
      const context = await this.resolveWebhookContext(req, AppIncomingWebhookType.SLACK);
      if (!context) {
        res.status(400).send('invalid_payload');
        return;
      }
      logger.info('[INCOMING-WEBHOOK] BODY', {
        body: context.body });

      await processSlackIncoming(context, res);
    } catch (error) {
      logger.error('[Incoming-Webhook] Error handling incoming webhook', {
        error });
      res.status(500).send('rollup_error');
    }
  };

  handleSentinelIncoming = async (req: Request, res: Response): Promise<void> => {
    try {
      const context = await this.resolveWebhookContext(req, AppIncomingWebhookType.SENTINELONE);
      if (!context) {
        res.status(400).send('invalid_payload');
        return;
      }

      await processSentinelIncoming(context, res);
    } catch (error) {
      logger.error('[Incoming-Webhook] Error handling SentinelOne webhook', {
        error });
      res.status(500).send('rollup_error');
    }
  };

  handleAmazonSnsIncoming = async (req: Request, res: Response): Promise<void> => {
    try {
      const context = await this.resolveWebhookContext(req, AppIncomingWebhookType.AMAZON_SNS);
      if (!context) {
        res.status(400).send('invalid_payload');
        return;
      }

      const envelope = parseSnsEnvelope(context.body);
      if (!envelope) {
        logger.warn('[Incoming-Webhook] Body is not an Amazon SNS envelope', {
          workspaceId: context.workspaceId,
          appId: context.appId });
        res.status(400).send('invalid_payload');
        return;
      }

      // No signature check: the encrypted secret in the URL is the only
      // credential here, as it is for the Slack and SentinelOne webhook types.

      await processAmazonSnsIncoming(context, res, envelope);
    } catch (error) {
      logger.error('[Incoming-Webhook] Error handling Amazon SNS webhook', {
        error });
      res.status(500).send('rollup_error');
    }
  };

  handlePingdomIncoming = async (req: Request, res: Response): Promise<void> => {
    try {
      const context = await this.resolveWebhookContext(req, AppIncomingWebhookType.PINGDOM);
      if (!context) {
        res.status(400).send('invalid_payload');
        return;
      }

      const payload = parsePingdomPayload(context.body);
      if (!payload) {
        logger.warn('[Incoming-Webhook] Body is not a Pingdom check notification', {
          workspaceId: context.workspaceId,
          appId: context.appId });
        res.status(400).send('invalid_payload');
        return;
      }

      // No signature check: the encrypted secret in the URL is the only
      // credential here, as it is for the Slack and Amazon SNS webhook types.

      await processPingdomIncoming(context, res, payload);
    } catch (error) {
      logger.error('[Incoming-Webhook] Error handling Pingdom webhook', {
        error });
      res.status(500).send('rollup_error');
    }
  };

  handleGcpIncoming = async (req: Request, res: Response): Promise<void> => {
    try {
      const context = await this.resolveWebhookContext(req, AppIncomingWebhookType.GCP);
      if (!context) {
        res.status(400).send('invalid_payload');
        return;
      }

      const payload = parseGcpPayload(context.body);
      if (!payload) {
        logger.warn('[Incoming-Webhook] Body is not a GCP Monitoring incident', {
          workspaceId: context.workspaceId,
          appId: context.appId });
        res.status(400).send('invalid_payload');
        return;
      }

      // No signature check: the encrypted secret in the URL is the only
      // credential here, replacing the HTTP Basic auth infra-switch uses on its
      // shared /alertProxy/gcp endpoint.

      await processGcpIncoming(context, res, payload);
    } catch (error) {
      logger.error('[Incoming-Webhook] Error handling GCP Monitoring webhook', {
        error });
      res.status(500).send('rollup_error');
    }
  };

  handleHubspotIncoming = async (req: Request, res: Response): Promise<void> => {
    try {
      const context = await this.resolveWebhookContext(req, AppIncomingWebhookType.HUBSPOT);
      if (!context) {
        res.status(400).send('invalid_payload');
        return;
      }

      // A batch, not a single notification: HubSpot POSTs a JSON array and one
      // request can carry many CRM change events.
      const events = parseHubspotPayload(context.body);
      if (!events) {
        logger.warn('[Incoming-Webhook] Body is not a HubSpot event batch', {
          workspaceId: context.workspaceId,
          appId: context.appId });
        res.status(400).send('invalid_payload');
        return;
      }

      // No signature check: the encrypted secret in the URL is the only
      // credential here, as it is for the Slack, Pingdom and GCP webhook types.
      // Verifying X-HubSpot-Signature-v3 would additionally need the HubSpot
      // app's client secret stored per webhook; the raw body it hashes is
      // already preserved by this route's express.text() parser.

      // Ack before doing any work. HubSpot treats a response slower than five
      // seconds as a failure and redelivers the whole batch up to ten times
      // across 24 hours, growing it each round — so posting first and replying
      // afterwards turns one slow channel write into a retry storm.
      res.status(200).send('ok');

      if (events.length === 0) {
        return;
      }

      try {
        await processHubspotIncoming(context, events);
      } catch (error) {
        // The 200 is already on the wire, so this can only be logged.
        logger.error('[Incoming-Webhook] Error processing HubSpot batch after ack', {
          eventCount: events.length,
          error });
      }
    } catch (error) {
      logger.error('[Incoming-Webhook] Error handling HubSpot webhook', {
        error });
      if (!res.headersSent) {
        res.status(500).send('rollup_error');
      }
    }
  };

  /**
   * Complete the SNS handshake for the "Do Confirmation" button.
   *
   * The submit lands on /api/apps/flow/action, which flowController routes here
   * rather than proxying — an incoming webhook has no outbound webhookUrl to
   * proxy to. The card is left as-is; the renderer toasts on success.
   *
   * Always returns `ack`, so a failure never raises an error toast. Only a 200
   * carries a `message`, and only a message produces a toast — the reason for a
   * failure is logged rather than shown.
   */
  confirmSnsSubscription = async (
    values: Record<string, unknown>,
  ): Promise<{ type: 'ack'; message?: string }> => {
    const subscribeUrl = values['subscribeUrl'];

    if (typeof subscribeUrl !== 'string' || !subscribeUrl) {
      logger.warn('[Incoming-Webhook] SNS confirm called without a SubscribeURL');
      return { type: 'ack' };
    }

    // SSRF guard: this endpoint is authenticated but SubscribeURL is fully
    // attacker-controlled body input. A genuine SNS confirmation URL is always
    // https on sns.<region>.amazonaws.com, so pin the host to that AND run the
    // shared private-range/DNS guard to defeat DNS rebinding. Failures fall
    // through to the standard `ack` (no error toast, reason logged).
    let parsedSubscribeUrl: URL;
    try {
      parsedSubscribeUrl = new URL(subscribeUrl);
    } catch {
      logger.warn('[Incoming-Webhook] SNS confirm rejected: invalid SubscribeURL');
      return { type: 'ack' };
    }
    const isAmazonSnsHost =
      parsedSubscribeUrl.protocol === 'https:' &&
      /^sns\.[a-z0-9-]+\.amazonaws\.com$/i.test(parsedSubscribeUrl.hostname);
    if (!isAmazonSnsHost) {
      logger.warn('[Incoming-Webhook] SNS confirm rejected: SubscribeURL is not an Amazon SNS https host', {
        host: parsedSubscribeUrl.hostname });
      return { type: 'ack' };
    }
    try {
      await assertWebhookUrlSafe(subscribeUrl);
    } catch (error) {
      if (error instanceof SsrfBlockedError) {
        logger.warn('[Incoming-Webhook] SNS confirm blocked by SSRF guard', { error: error.message });
        return { type: 'ack' };
      }
      throw error;
    }

    try {
      // Pin the connection to the address just validated (rebinding-safe).
      const response = await safeWebhookFetch(subscribeUrl, {
        method: 'GET',
        // A redirect would take this somewhere we never intended, so treat one
        // as a failure rather than following it.
        redirect: 'manual',
        signal: AbortSignal.timeout(15_000) });

      if (response.status === 200) {
        logger.info('[Incoming-Webhook] SNS subscription confirmed');
        return { type: 'ack', message: 'Confirmation done' };
      }

      // 400 usually means the token expired (they last 3 days) or the
      // subscription was already confirmed.
      logger.warn('[Incoming-Webhook] SNS confirmation rejected', { status: response.status });
    } catch (error) {
      logger.error('[Incoming-Webhook] SNS confirmation request failed', { error });
    }

    return { type: 'ack' };
  };
}

export const incomingWebhookController = new IncomingWebhookController();
