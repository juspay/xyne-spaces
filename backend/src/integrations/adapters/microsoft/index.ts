/**
 * Microsoft adapter — auto-registered on import.
 */

import { AdapterFactory } from '../../core/adapterFactory';
import { ExternalSourcePlatform } from '../../core/types';
import { MicrosoftAuthenticator } from './authenticator';
import { MicrosoftTransformer } from './transformer';
import { MicrosoftFlow } from './flow';
import { MicrosoftPostprocessor } from './postprocessor';
import { MicrosoftRefetch } from './refetch';

export const microsoftAdapter = AdapterFactory.create(
  ExternalSourcePlatform.MICROSOFT,
  new MicrosoftAuthenticator(),
  new MicrosoftTransformer(),
  new MicrosoftFlow(),
  new MicrosoftPostprocessor(),
  new MicrosoftRefetch(),
);

export { MicrosoftAuthenticator } from './authenticator';
export { MicrosoftTransformer } from './transformer';
export { MicrosoftFlow } from './flow';
export { MicrosoftPostprocessor } from './postprocessor';
export { MicrosoftRefetch } from './refetch';
export * from './types';
