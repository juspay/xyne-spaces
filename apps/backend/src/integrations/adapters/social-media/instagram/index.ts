import { AdapterFactory } from '@/integrations/core/adapterFactory';
import { ExternalSourcePlatform } from '@/integrations/core/types';
import { MetaWebhookAuthenticator } from '../shared/metaWebhookAuthenticator';
import { config } from '@/config/env';
import { logger } from '@/utils/logger';
import { InstagramFlow } from './flow';
import { InstagramTransformer } from './transformer';
import { MetaPostprocessor } from '../shared/metaPostprocessor';
import { InstagramReplySender } from './replySender';

export const instagramAdapter = AdapterFactory.create(
  ExternalSourcePlatform.INSTAGRAM,
  // Instagram Business Login webhooks are signed with the Instagram-specific app secret.
  // Fall back to the Facebook app secret only if META_IG_APP_SECRET is absent.
  new MetaWebhookAuthenticator(() => {
    if (config.META_IG_APP_SECRET) return config.META_IG_APP_SECRET;
    logger.warn('[InstagramAuthenticator] META_IG_APP_SECRET not set — falling back to META_APP_SECRET; set META_IG_APP_SECRET for Instagram Business Login');
    return config.META_APP_SECRET;
  }),
  new InstagramTransformer(),
  new InstagramFlow(),
  new MetaPostprocessor('[InstagramPostprocessor]'),
  undefined, // no refetcher — webhook push only
  undefined, // no mailReplySender
  new InstagramReplySender(),
);
