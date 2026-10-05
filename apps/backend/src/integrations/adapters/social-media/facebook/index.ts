import { AdapterFactory } from '@/integrations/core/adapterFactory';
import { ExternalSourcePlatform } from '@/integrations/core/types';
import { MetaPostprocessor } from '../shared/metaPostprocessor';
import { MetaWebhookAuthenticator } from '../shared/metaWebhookAuthenticator';
import { config } from '@/config/env';
import { FacebookFlow } from './flow';
import { FacebookTransformer } from './transformer';
import { FacebookReplySender } from './replySender';

export const facebookAdapter = AdapterFactory.create(
  ExternalSourcePlatform.FACEBOOK,
  new MetaWebhookAuthenticator(() => config.META_APP_SECRET),
  new FacebookTransformer(),
  new FacebookFlow(),
  new MetaPostprocessor('[FacebookPostprocessor]'),
  undefined, // no refetcher — webhook push only
  undefined, // no mailReplySender
  new FacebookReplySender(),
);
