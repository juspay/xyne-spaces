/**
 * Slack Desk adapter - auto-registers on import
 * Converts Slack channel messages into Xyne Desk tickets using the Email model.
 * Dynamically routes to different ExternalSource records based on Slack channel ID.
 *
 * Reuses:
 * - SlackAuthenticator from slack-webhook-tickets (HMAC-SHA256 verification)
 * - SlackBlockKitParser for content rendering
 * - SlackUserResolver for @mention resolution
 */

import { AdapterFactory } from '../../core/adapterFactory';
import { ExternalSourcePlatform } from '../../core/types';
import { SlackAuthenticator } from '../slack-webhook-tickets/authenticator';
import { SlackDeskTransformer } from './transformer';
import { SlackDeskFlow } from './flow';
import { SlackDeskPostprocessor } from './postprocessor';

export const slackDeskAdapter = AdapterFactory.create(
  ExternalSourcePlatform.SLACK_DESK,
  new SlackAuthenticator(),
  new SlackDeskTransformer(),
  new SlackDeskFlow(),
  new SlackDeskPostprocessor()
);
