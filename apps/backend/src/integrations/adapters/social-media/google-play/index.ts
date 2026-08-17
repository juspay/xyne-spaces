import { AdapterFactory } from '@/integrations/core/adapterFactory';
import { ExternalSourcePlatform } from '@/integrations/core/types';
import { GooglePlayReviewsFlow } from './flow';
import { GooglePlayReviewsPostprocessor } from './postprocessor';
import { GooglePlayReviewsReplySender } from './replySender';
import { GooglePlayReviewsTransformer } from './transformer';

export const googlePlayReviewsAdapter = AdapterFactory.createPolling(
  ExternalSourcePlatform.GOOGLE_PLAY,
  new GooglePlayReviewsTransformer(),
  new GooglePlayReviewsFlow(),
  new GooglePlayReviewsPostprocessor(),
  new GooglePlayReviewsReplySender()
);

export { GooglePlayReviewsFlow } from './flow';
export { GooglePlayReviewsTransformer } from './transformer';
export { GooglePlayReviewsPostprocessor } from './postprocessor';
export { GooglePlayReviewsReplySender } from './replySender';
