/**
 * Microsoft adapter
 * Auto-registered on import
 */

import { AdapterFactory } from '../../core/adapterFactory';
import { ExternalSourcePlatform } from '../../core/types';
import { MicrosoftAuthenticator } from './authenticator';
import { MicrosoftTransformer } from './transformer';
import { MicrosoftFlow } from './flow';

/**
 * Create and register Microsoft adapter
 * Registration happens automatically when this file is imported
 *
 * Flow handles preprocessing to fetch actual email content from Graph API
 * (Graph webhooks only send notification IDs, not email content)
 */
export const microsoftAdapter = AdapterFactory.create(
  ExternalSourcePlatform.MICROSOFT,
  new MicrosoftAuthenticator(),
  new MicrosoftTransformer(),
  new MicrosoftFlow()
);

export { MicrosoftAuthenticator } from './authenticator';
export { MicrosoftTransformer } from './transformer';
export { MicrosoftFlow } from './flow';
export * from './types';
