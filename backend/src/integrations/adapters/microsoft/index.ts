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
import { MicrosoftMailReplySender } from './mailReplySender';

export const microsoftAdapter = AdapterFactory.create(
  ExternalSourcePlatform.MICROSOFT,
  new MicrosoftAuthenticator(),
  new MicrosoftTransformer(),
  new MicrosoftFlow(),
  new MicrosoftPostprocessor(),
  new MicrosoftRefetch(),
  new MicrosoftMailReplySender(),
);

export { MicrosoftAuthenticator } from './authenticator';
export { MicrosoftTransformer } from './transformer';
export { MicrosoftFlow } from './flow';
export { MicrosoftPostprocessor } from './postprocessor';
export { MicrosoftRefetch } from './refetch';
export { MicrosoftMailReplySender } from './mailReplySender';
export * from './types';
