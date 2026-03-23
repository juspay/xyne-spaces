import type { ConversationSource, ConversationSourceAdapter } from './types';
import { WorkflowExecutionAdapter } from './adapters/workflowExecutionAdapter';
import { SessionAdapter } from './adapters/sessionAdapter';

export function createAdapter(
  source: ConversationSource,
  gcsUri: string,
  sourceId: string,
): ConversationSourceAdapter {
  switch (source) {
    case 'workflowSteps':
      return new WorkflowExecutionAdapter(gcsUri, sourceId);
    case 'xyne-cli':
      return new SessionAdapter(gcsUri, sourceId);
    default:
      throw new Error(`Unknown conversation source: ${source}`);
  }
}
