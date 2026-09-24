import { AdapterFactory } from '@/integrations/core/adapterFactory';
import { ExternalSourcePlatform } from '@/integrations/core/types';
import { AppStoreReviewsFlow } from './flow';
import { AppStoreReviewsPostprocessor } from './postprocessor';
import { AppStoreReviewsReplySender } from './replySender';
import { AppStoreReviewsTransformer } from './transformer';

const appStoreReviewsFlow = new AppStoreReviewsFlow();

export const appStoreReviewsAdapter = AdapterFactory.createPolling(
  ExternalSourcePlatform.APP_STORE,
  new AppStoreReviewsTransformer(),
  appStoreReviewsFlow,
  new AppStoreReviewsPostprocessor(),
  new AppStoreReviewsReplySender(),
);

// The flow knows whether the run actually covered its window; the cursor write must respect that.
appStoreReviewsAdapter.resolveNextCursor = (source, syncStartedAt) =>
  appStoreReviewsFlow.resolveNextCursor(source, syncStartedAt);

// Bounded retries per review, so one permanently-bad item cannot wedge the cursor forever.
appStoreReviewsAdapter.onIngestFailures = (source, failedExternalIds) =>
  appStoreReviewsFlow.onIngestFailures(source, failedExternalIds);

export { AppStoreReviewsFlow } from './flow';
export { AppStoreReviewsTransformer } from './transformer';
export { AppStoreReviewsPostprocessor } from './postprocessor';
export { AppStoreReviewsReplySender } from './replySender';
export { reconcilePendingResponses } from './reconciler';
