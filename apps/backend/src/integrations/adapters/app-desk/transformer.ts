import { ExternalSource } from '@prisma/client';
import { BaseTransformer } from '../../core/baseTransformer';
import { NormalizedData, ParseResult } from '../../core/types';

/**
 * Intentionally unreachable: the factory default authenticator denies every
 * request at /:sourceName/ingest, so transform never runs. App-desk inbound
 * tickets arrive via POST /api/apps/tickets/appDeskInbound instead, and pulled
 * history is persisted directly by AppDeskRefetch — this adapter only exists
 * so source.name 'app-desk-*' resolves in the registry.
 */
export class AppDeskTransformer extends BaseTransformer<unknown, NormalizedData> {
  async transform(
    _rawPayload: unknown,
    _source?: ExternalSource,
  ): Promise<ParseResult<NormalizedData>> {
    return {
      success: false,
      error: 'app-desk tickets arrive via /api/apps/tickets/appDeskInbound, not the webhook ingest pipeline',
    };
  }
}
