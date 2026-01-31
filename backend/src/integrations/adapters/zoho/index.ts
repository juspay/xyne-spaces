/**
 * Zoho adapter
 * Auto-registered on import
 */

import { AdapterFactory } from '../../core/adapterFactory';
import { ExternalSourcePlatform } from '../../core/types';
import { ZohoAuthenticator } from './authenticator';
import { ZohoTransformer } from './transformer';

/**
 * Create and register Zoho adapter
 * Registration happens automatically when this file is imported
 *
 * Note: No flow needed - Zoho doesn't require preprocessing
 */
export const zohoAdapter = AdapterFactory.create(
  ExternalSourcePlatform.ZOHO,
  new ZohoAuthenticator(),
  new ZohoTransformer()
  // No flow parameter - not needed for Zoho
);

// Export components for testing
export { ZohoAuthenticator } from './authenticator';
export { ZohoTransformer } from './transformer';
export * from './types';
