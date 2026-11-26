import { AdapterFactory } from '@/integrations/core/adapterFactory';
import { ExternalSourcePlatform } from '@/integrations/core/types';
import { MetaPostprocessor } from '../shared/metaPostprocessor';
import { xFlow } from './flow';
import { XReplySender } from './replySender';
import { XTransformer } from './transformer';

/**
 * X adapter. Events arrive over the per-app activity stream, which calls externalSourceCore.ingest
 * with an XInboundItem; with no payload (manual sync, stream gap repair) the flow polls X instead.
 * Never fed by the HTTP ingest route, so there is no authenticator (the default rejects every POST).
 * MetaPostprocessor is platform-neutral despite the name: custom-field sync + reopen on new inbound.
 */
export const xAdapter = AdapterFactory.create(
  ExternalSourcePlatform.X,
  undefined,
  new XTransformer(),
  xFlow,
  new MetaPostprocessor('[XPostprocessor]'),
  undefined,
  undefined,
  new XReplySender(),
);

// Polling runs that hit a cap must not advance the cursor.
xAdapter.resolveNextCursor = (source, syncStartedAt) => xFlow.resolveNextCursor(source, syncStartedAt);

export { XApiClient, XApiError, xApiClient } from './client';
export { xTokenService } from './tokenService';
export * from './normalizer';
export * from './transformer';
export type * from './types';
export { xchatService, XChatUnlockError } from './xchat';
export { xPoller } from './poller';
