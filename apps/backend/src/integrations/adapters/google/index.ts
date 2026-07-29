/**
 * Google Gmail adapter — auto-registered on import.
 */

import { AdapterFactory } from '../../core/adapterFactory';
import { ExternalSourcePlatform } from '../../core/types';
import { GoogleAuthenticator } from './authenticator';
import { GoogleTransformer } from './transformer';
import { GoogleFlow } from './flow';
import { GooglePostprocessor } from './postprocessor';
import { GoogleRefetch } from './refetch';
import { GoogleMailReplySender } from './mailReplySender';

export const googleAdapter = AdapterFactory.create(
  ExternalSourcePlatform.GOOGLE,
  new GoogleAuthenticator(),
  new GoogleTransformer(),
  new GoogleFlow(),
  new GooglePostprocessor(),
  new GoogleRefetch(),
  new GoogleMailReplySender(),
);

export { GoogleAuthenticator } from './authenticator';
export { GoogleTransformer } from './transformer';
export { GoogleFlow } from './flow';
export { GooglePostprocessor } from './postprocessor';
export { GoogleRefetch } from './refetch';
export { GoogleMailReplySender } from './mailReplySender';
export * from './types';
