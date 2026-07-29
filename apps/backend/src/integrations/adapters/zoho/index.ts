/**
 * Zoho adapter
 * Auto-registered on import
 */

import { AdapterFactory } from '../../core/adapterFactory';
import { ExternalSourcePlatform } from '../../core/types';
import { ZohoAuthenticator } from './authenticator';
import { ZohoTransformer } from './transformer';
import { ZohoFlow } from './flow';

/**
 * Create and register Zoho adapter
 * Registration happens automatically when this file is imported
 *
 * Flow handles preprocessing to fetch missing email fields from Zoho API
 * (Zoho stopped sending to/fromEmailAddress in webhooks)
 */
export const zohoAdapter = AdapterFactory.create(
  ExternalSourcePlatform.ZOHO,
  new ZohoAuthenticator(),
  new ZohoTransformer(),
  new ZohoFlow()
);

// Export components for testing
export { ZohoAuthenticator } from './authenticator';
export { ZohoTransformer } from './transformer';
export { ZohoFlow } from './flow';
export * from './types';
