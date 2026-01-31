/**
 * Slack adapter - auto-registers on import
 * Converts Slack thread messages into Xyne conversations
 * Auto-creates tickets and workflows for top-level messages
 * Dynamically routes to different sources based on Slack channel ID
 */

import { AdapterFactory } from '../../core/adapterFactory';
import { ExternalSourcePlatform } from '../../core/types';
import { SlackAuthenticator } from './authenticator';
import { SlackTransformer } from './transformer';
import { SlackPostprocessor } from './postprocessor';
import { SlackFlow } from './flow';

export const slackAdapter = AdapterFactory.create(
  ExternalSourcePlatform.SLACK,
  new SlackAuthenticator(),
  new SlackTransformer(),
  new SlackFlow(), 
  new SlackPostprocessor()
);

export { SlackAuthenticator } from './authenticator';
export { SlackTransformer } from './transformer';
export { SlackPostprocessor } from './postprocessor';
export { SlackFlow } from './flow';
export * from './types';
