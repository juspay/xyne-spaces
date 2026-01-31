/**
 * Utility functions for Xyne AI Session Storage
 */

import type { AgentHistoryOutput, FormattedHistoryMessage, XyneAIOutput } from '../types';
import type { HistoryMessage } from './types';
import type { MessageData } from './customPostgresProvider';

/**
 * Format history messages for JAF agent context
 * 
 * Converts stored messages to JAF format:
 * - user: { query, timestamp } → "query text"
 * - assistant: { summary, keyPoints } → { summary, keypoints, citations }
 */
export function formatHistoryForJAF(history: HistoryMessage[]): FormattedHistoryMessage[] {
  const messages: FormattedHistoryMessage[] = [];

  for (const msg of history) {
    if (msg.role === 'USER') {
      const content = msg.content;
      const queryText = typeof content === 'string' ? content : content.query;
      messages.push({ role: 'user', content: queryText });
    } else if (msg.role === 'ASSISTANT') {
      // msg.content is XyneAIOutput directly
      const output = msg.content;
      
      if (typeof output === 'string') {
        messages.push({ 
          role: 'assistant', 
          content: { summary: output, keypoints: [], citations: {} } 
        });
      } else {
        const structuredOutput: AgentHistoryOutput = {
          summary: output.summary || '',
          keypoints: output.keyPoints?.map(kp => kp.point) || [],
          citations: output.keyPoints?.reduce((acc, kp, idx) => {
            if (kp.citation?.prefixedRef) {
              acc[idx + 1] = kp.citation.prefixedRef;
            }
            return acc;
          }, {} as Record<number, string>) || {},
        };
        messages.push({ role: 'assistant', content: structuredOutput });
      }
    }
  }

  return messages;
}

/**
 * Convert MessageData[] from DB to HistoryMessage[] for session
 * 
 * Only includes user and assistant messages in history.
 * Tool messages are stored but excluded from JAF context.
 */
export function convertMessagesToHistory(messages: MessageData[]): HistoryMessage[] {
  const history: HistoryMessage[] = [];
  
  for (const msg of messages) {
    if (msg.role === 'USER') {
      const content = msg.content as { query: string; timestamp: string };
      history.push({
        role: 'USER',
        content: { query: content.query, timestamp: content.timestamp },
      });
    } else if (msg.role === 'ASSISTANT') {
      history.push({
        role: 'ASSISTANT',
        content: msg.content as XyneAIOutput,
      });
    }
    // Tool messages are stored but not included in history for JAF context
  }
  
  return history;
}
