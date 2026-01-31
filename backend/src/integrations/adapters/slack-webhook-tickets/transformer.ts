/**
 * Slack transformer - converts Slack Events API webhooks to normalized format
 * Handles markdown conversion: *bold*, _italic_, ~strikethrough~, `code`, ```blocks```, links, lists
 */

import { BaseTransformer } from '../../core/baseTransformer';
import { NormalizedData, ParseResult } from '../../core/types';
import { SlackWebhookPayload, SlackEvent } from './types';
import { SlackBlockKitParser } from './utils/slackBlockKitParser';

export class SlackTransformer extends BaseTransformer<SlackWebhookPayload, NormalizedData> {
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

      // For message_changed events, extract the actual message from the nested structure
      const actualMessage = event.subtype === 'message_changed' && event.message
        ? event.message
        : event;

        
      if (!this.hasContent(actualMessage)) {
        return {
          success: false,
          error: `Event type ${event.type} has no content to process`,
        };
      }

      // Use Block Kit parser for all content
      const content = this.blockKitParser.parse({
        text: actualMessage.text,
        attachments: actualMessage.attachments,
      });

      const normalized: NormalizedData = {
        externalId: actualMessage.ts,
        externalThreadId: actualMessage.thread_ts || actualMessage.ts,
        externalParentId: actualMessage.thread_ts,
        author: {
          name: actualMessage.user || actualMessage.bot_id || 'Unknown',
          email: undefined,
          externalId: actualMessage.user || actualMessage.bot_id || 'unknown',
        },
        content: content,
        attachments: actualMessage.files?.map(file => ({
          fileName: file.name,
          fileUrl: file.url_private,
          mimeType: file.mimetype,
          size: file.size,
        })),
        metadata: {
          eventType: event.subtype === 'message_changed' ? 'message_changed' : event.type,
          timestamp: this.parseTimestamp(event.event_ts || actualMessage.ts),
          channel: event.channel,
          channelType: event.channel_type,
          isTopLevelMessage: !actualMessage.thread_ts || actualMessage.thread_ts === actualMessage.ts,
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

    // Message must have either text or files
    const hasText = !!message.text?.trim();
    const hasFiles = !!message.files && message.files.length > 0;

    if (!hasText && !hasFiles) {
      return false;
    }

    if (!message.user && !message.bot_id) {
      return false;
    }

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
