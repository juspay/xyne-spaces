import type { ConversationSource, ConversationSourceAdapter } from './types';
import { SessionAdapter } from './adapters/sessionAdapter';

export function createAdapter(
  source: ConversationSource,
  gcsUri: string,
  sourceId: string,
): ConversationSourceAdapter {
  switch (source) {
    case 'xyne-cli':
      return new SessionAdapter(gcsUri, sourceId);
    default:
      throw new Error(`Unknown conversation source: ${source}`);
  }
}
