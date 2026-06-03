/**
 * Slack Desk transformer - converts Slack Events API webhooks to normalized format
 * with emailData fields so the core pipeline treats Slack messages like emails.
 *
 * Reuses SlackBlockKitParser from slack-webhook-tickets for content rendering.
 */

import { convert } from 'html-to-text';
import { BaseTransformer } from '../../core/baseTransformer';
import { NormalizedData, ParseResult } from '../../core/types';
import { SlackWebhookPayload, SlackEvent } from '../slack-webhook-tickets/types';
import { SlackBlockKitParser } from '../slack-webhook-tickets/utils/slackBlockKitParser';

export class SlackDeskTransformer extends BaseTransformer<SlackWebhookPayload, NormalizedData> {
  private blockKitParser: SlackBlockKitParser;

  constructor() {
    super();
    this.blockKitParser = new SlackBlockKitParser();
  }

  async transform(payload: SlackWebhookPayload): Promise<ParseResult<NormalizedData>> {
    try {
      if (!this.validateStructure(payload)) {
        return {
          success: false,
          error: 'Invalid Slack webhook structure: missing type or event',
        };
      }

      const { event } = payload;

      // For message_changed events, extract the actual message
      const actualMessage = event.subtype === 'message_changed' && event.message
        ? event.message
        : event;

      if (!this.hasContent(actualMessage)) {
        return {
          success: false,
          error: `Event type ${event.type} has no content to process`,
        };
      }

      // Use Block Kit parser for content → HTML
      const content = this.blockKitParser.parse({
        text: actualMessage.text,
        attachments: actualMessage.attachments,
      });

      // Use resolved author info from flow preprocess, fall back to raw Slack ID
      const resolvedAuthor = (payload as any)._resolvedAuthor as
        | { name: string; email?: string }
        | undefined;
      const authorName = resolvedAuthor?.name || actualMessage.user || actualMessage.bot_id || 'Unknown';
      const authorEmail = resolvedAuthor?.email;
      const isTopLevel = !actualMessage.thread_ts || actualMessage.thread_ts === actualMessage.ts;

      // Extract first line of text as subject (for ticket title).
      // The text may contain HTML spans from resolved @mentions/channels —
      // convert to plain text so the ticket title is clean.
      const rawText = (actualMessage.text || '').trim();
      const firstLine = rawText.split('\n')[0];
      const subject = convert(firstLine, { wordwrap: false }).substring(0, 200) || 'Slack message';

      // Format "from" field: "Display Name <email>" if email available, else just the name
      const fromField = authorEmail
        ? `${authorName} <${authorEmail}>`
        : authorName;

      const normalized: NormalizedData = {
        externalId: actualMessage.ts,
        externalThreadId: actualMessage.thread_ts || actualMessage.ts,
        externalParentId: actualMessage.thread_ts,
        author: {
          name: authorName,
          email: authorEmail,
          externalId: actualMessage.user || actualMessage.bot_id || 'unknown',
        },
        content,
        attachments: actualMessage.files?.map(file => ({
          fileName: file.name,
          fileUrl: file.url_private,
          mimeType: file.mimetype,
          size: file.size,
        })),
        // Populate emailData so the core pipeline creates Email records
        emailData: {
          subject,
          from: fromField,
          to: [],
        },
        metadata: {
          eventType: event.subtype === 'message_changed' ? 'message_changed' : 'slack_desk_message',
          timestamp: this.parseTimestamp(event.event_ts || actualMessage.ts),
          channel: event.channel,
          source: 'slack',
          slackChannelId: event.channel,
          authorExternalId: actualMessage.user || actualMessage.bot_id || 'unknown',
          isTopLevelMessage: isTopLevel,
        },
      };

      return { success: true, data: normalized };
    } catch (error) {
      return {
        success: false,
        error: `Transform error: ${error instanceof Error ? error.message : 'Unknown error'}`,
      };
    }
  }

  private validateStructure(payload: any): boolean {
    return !!(payload && payload.type && payload.event && payload.event.type && payload.event.ts);
  }

  private hasContent(message: SlackEvent | SlackEvent['message']): boolean {
    if (!message) return false;
    const hasText = !!message.text?.trim();
    const hasFiles = !!message.files && message.files.length > 0;
    if (!hasText && !hasFiles) return false;
    if (!message.user && !message.bot_id) return false;
    return true;
  }

  private parseTimestamp(ts: string): Date {
    try {
      const seconds = parseFloat(ts);
      return new Date(seconds * 1000);
    } catch {
      return new Date();
    }
  }
}
