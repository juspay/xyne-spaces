import { AdapterFactory } from '@/integrations/core/adapterFactory';
import { ExternalSourcePlatform } from '@/integrations/core/types';
import { InstagramAuthenticator } from './authenticator';
import { InstagramFlow } from './flow';
import { InstagramTransformer } from './transformer';
import { InstagramPostprocessor } from './postprocessor';
import { InstagramReplySender } from './replySender';

export const instagramAdapter = AdapterFactory.create(
  ExternalSourcePlatform.INSTAGRAM,
  new InstagramAuthenticator(),
  new InstagramTransformer(),
  new InstagramFlow(),
  new InstagramPostprocessor(),
  undefined, // no refetcher — webhook push only
  undefined, // no mailReplySender
  new InstagramReplySender(),
);
