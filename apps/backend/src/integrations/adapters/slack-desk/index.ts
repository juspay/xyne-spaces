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

const slackDeskFlow = new SlackDeskFlow();

export const slackDeskAdapter = AdapterFactory.create(
  ExternalSourcePlatform.SLACK_DESK,
  new SlackAuthenticator(),
  new SlackDeskTransformer(),
  slackDeskFlow,
  new SlackDeskPostprocessor()
);

// Frees the thread-backfill lock when the root message fails to sync.
slackDeskAdapter.onIngestFailures = (source, failedExternalIds) =>
  slackDeskFlow.onIngestFailures(source, failedExternalIds);
