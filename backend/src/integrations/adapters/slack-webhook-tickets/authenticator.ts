/**
 * Slack authenticator - verifies HMAC-SHA256 signatures on webhook requests
 *
 * Authentication process:
 * 1. Extracts signing secret from encrypted credentials stored in database
 * 2. Validates x-slack-signature and x-slack-request-timestamp headers
 * 3. Checks timestamp is within 5 minutes (prevents replay attacks)
 * 4. Stringifies body with canonical JSON for signature verification
 * 5. Computes HMAC-SHA256: v0:timestamp:body using signing secret
 * 6. Compares computed signature with Slack's signature (timing-safe)
 *
 * Required credentials format: {"signingSecret": "your_slack_signing_secret"}
 * The signing secret is obtained from Slack App's "Basic Information" page
 */

import crypto from 'crypto';
import { BaseAuthenticator } from '../../core/baseAuthenticator';
import { AuthResult } from '../../core/types';
import { ExternalSourceRepository } from '../../../database/repositories/externalSourceRepository';
import { ExternalMessageRepository } from '../../../database/repositories/externalMessageRepository';
import { SlackWebhookPayload, SlackEventType } from './types';

export class SlackAuthenticator extends BaseAuthenticator {
  private readonly MAX_TIMESTAMP_AGE = 60 * 5; // 5 minutes
  private readonly supportedEventTypes = new Set<SlackEventType>([
    SlackEventType.MESSAGE,
    SlackEventType.APP_MENTION,
  ]);
  private readonly rejectedSubtypes = new Set<string>([
    'message_deleted',
    'channel_join',
    'channel_leave',
    'channel_topic',
    'channel_purpose',
  ]);

  private externalSourceRepo = new ExternalSourceRepository();
  private externalMessageRepo = new ExternalMessageRepository();

  async authenticate(
    rawBody: string,
    headers: Record<string, string | string[]>,
    credentialsJson: string,
    sourceName: string
  ): Promise<AuthResult> {
    try {
      const payload = JSON.parse(rawBody) as SlackWebhookPayload;
      const credentials = this.parseCredentials(credentialsJson);

      const botResult = this.validateBotSource(payload, credentials.whiteListedBots);
      if (botResult) {
        return botResult;
      }

      const slackSignature = this.getHeader(headers, 'x-slack-signature');
      const requestTimestamp = this.getHeader(headers, 'x-slack-request-timestamp');

      if (
        !this.isTimestampValid(requestTimestamp) ||
        !this.verifySignature(rawBody, slackSignature, requestTimestamp, credentials.signingSecret)
      ) {
        return { authenticated: false };
      }

      const supportedEventResult = this.validateEventShape(payload);
      if (!supportedEventResult.supported) {
        return supportedEventResult.result;
      }

      if (await this.isOrphanThreadMessage(payload, sourceName)) {
        return {
          authenticated: true,
          skipProcessing: true,
          reason: 'orphan_thread_message',
        };
      }

      return { authenticated: true };
    } catch (error) {
      return { authenticated: false };
    }
  }

  private async isOrphanThreadMessage(
    payload: SlackWebhookPayload,
    sourceName: string
  ): Promise<boolean> {
    const event = payload?.event;
    if (!event?.thread_ts || event.thread_ts === event.ts) {
      return false;
    }
    if (!sourceName) {
      return false;
    }
    const source = await this.externalSourceRepo.findByName(sourceName);
    if (!source) {
      return false;
    }
    const threadAnchor = await this.externalMessageRepo.findByThreadId(source.id, event.thread_ts);
    return !threadAnchor;
  }

  private validateEventShape(
    payload: SlackWebhookPayload
  ): { supported: true } | { supported: false; result: AuthResult } {
    const event = payload?.event;
    if (!event) {
      return { supported: false, result: this.skip('missing_event') };
    }

    if (!this.supportedEventTypes.has(event.type as SlackEventType)) {
      return {
        supported: false,
        result: this.skip(`unsupported_event_type:${event.type}`),
      };
    }

    if (event.subtype && this.rejectedSubtypes.has(event.subtype)) {
      return {
        supported: false,
        result: this.skip(`unsupported_subtype:${event.subtype}`),
      };
    }

    // For message_changed events, check the nested message object
    const actualMessage = event.subtype === 'message_changed' && event.message
      ? event.message
      : event;

    // Message must have either text or files
    const hasText = !!actualMessage.text?.trim();
    const hasFiles = !!actualMessage.files && actualMessage.files.length > 0;

    if (!hasText && !hasFiles) {
      return { supported: false, result: this.skip('empty_text_and_no_files') };
    }

    if (!actualMessage.user && !actualMessage.bot_id) {
      return { supported: false, result: this.skip('missing_author') };
    }

    return { supported: true };
  }

  private verifySignature(
    rawBody: string,
    slackSignature: string | undefined,
    requestTimestamp: string | undefined,
    signingSecret?: string
  ): boolean {
    if (!signingSecret || !slackSignature || !requestTimestamp) {
      return false;
    }

    const sigBaseString = `v0:${requestTimestamp}:${rawBody}`;
    const expectedSignature = this.calculateSignature(sigBaseString, signingSecret);
    return this.compareSignatures(slackSignature, expectedSignature);
  }

  private isTimestampValid(rawTimestamp: string | string[] | undefined): boolean {
    const timestamp = Array.isArray(rawTimestamp) ? rawTimestamp[0] : rawTimestamp;
    if (!timestamp) {
      return false;
    }

    const currentTime = Math.floor(Date.now() / 1000);
    const requestTime = parseInt(timestamp, 10);

    if (Number.isNaN(requestTime)) {
      return false;
    }

    return Math.abs(currentTime - requestTime) <= this.MAX_TIMESTAMP_AGE;
  }

  private validateBotSource(
    payload: SlackWebhookPayload,
    whitelist: string[] = []
  ): AuthResult | null {
    const event = payload?.event;
    if (event?.bot_id && Array.isArray(whitelist) && !whitelist.includes(event.bot_id)) {
      return this.skip('bot_not_whitelisted');
    }

    return null;
  }

  private parseCredentials(credentialsJson: string): {
    signingSecret?: string;
    whiteListedBots?: string[];
  } {
    if (!credentialsJson) {
      return {};
    }

    try {
      return JSON.parse(credentialsJson);
    } catch {
      return {};
    }
  }

  private getHeader(headers: Record<string, string | string[]>, key: string): string | undefined {
    const value = headers[key];
    return Array.isArray(value) ? value[0] : value;
  }

  private calculateSignature(data: string, secret: string): string {
    const hmac = crypto.createHmac('sha256', secret);
    hmac.update(data);
    return `v0=${hmac.digest('hex')}`;
  }

  private compareSignatures(signature1: string, signature2: string): boolean {
    try {
      return crypto.timingSafeEqual(Buffer.from(signature1), Buffer.from(signature2));
    } catch {
      return false;
    }
  }

  private skip(reason: string): AuthResult {
    return {
      authenticated: true,
      skipProcessing: true,
      reason,
    };
  }
}
