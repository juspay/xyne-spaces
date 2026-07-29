/**
 * Slack Events API payload types
 * Only includes fields that are actively consumed by the adapter
 */

import { SlackBlock, SlackAttachment } from './utils/slackBlockKitTypes';

export interface SlackWebhookPayload {
  type: string;
  event: SlackEvent;
  challenge?: string; // For url_verification
}

export interface SlackFile {
  name: string;
  mimetype: string;
  url_private: string;
  size: number;
}

export interface SlackEvent {
  type: string;
  channel: string;
  user?: string;
  text?: string;
  ts: string;
  thread_ts?: string;
  event_ts?: string;
  channel_type?: string;
  subtype?: string;
  bot_id?: string;
  blocks?: SlackBlock[];
  attachments?: SlackAttachment[];
  files?: SlackFile[];
  // For message_changed events, contains the updated message
  message?: {
    user?: string;
    text?: string;
    ts: string;
    thread_ts?: string;
    bot_id?: string;
    blocks?: SlackBlock[];
    attachments?: SlackAttachment[];
    files?: SlackFile[];
  };
}

export enum SlackEventType {
  MESSAGE = 'message',
  APP_MENTION = 'app_mention',
}
