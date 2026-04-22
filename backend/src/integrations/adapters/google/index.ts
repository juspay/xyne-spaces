/**
 * Google Gmail adapter — auto-registered on import.
 */

import { AdapterFactory } from '../../core/adapterFactory';
import { ExternalSourcePlatform } from '../../core/types';
import { GoogleAuthenticator } from './authenticator';
import { GoogleTransformer } from './transformer';
import { GoogleFlow } from './flow';

export const googleAdapter = AdapterFactory.create(
  ExternalSourcePlatform.GOOGLE,
  new GoogleAuthenticator(),
  new GoogleTransformer(),
  new GoogleFlow()
);

export { GoogleAuthenticator } from './authenticator';
export { GoogleTransformer } from './transformer';
export { GoogleFlow } from './flow';
export * from './types';
