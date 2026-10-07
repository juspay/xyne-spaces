import { AdapterFactory } from '@/integrations/core/adapterFactory';
import { ExternalSourcePlatform } from '@/integrations/core/types';
import { MetaPostprocessor } from '../shared/metaPostprocessor';
import { MetaWebhookAuthenticator } from '../shared/metaWebhookAuthenticator';
import { config } from '@/config/env';
import { FacebookFlow } from './flow';
import { FacebookTransformer } from './transformer';
import { FacebookReplySender } from './replySender';

const facebookFlow = new FacebookFlow();

export const facebookAdapter = AdapterFactory.create(
  ExternalSourcePlatform.FACEBOOK,
  new MetaWebhookAuthenticator(() => config.META_APP_SECRET),
  new FacebookTransformer(),
  facebookFlow,
  new MetaPostprocessor('[FacebookPostprocessor]'),
  undefined, // no refetcher — webhook push only
  undefined, // no mailReplySender
  new FacebookReplySender(),
);

// The flow knows what kind of fetch ran; the cursor write must respect that.
facebookAdapter.resolveNextCursor = (source, syncStartedAt) =>
  facebookFlow.resolveNextCursor(source, syncStartedAt);
