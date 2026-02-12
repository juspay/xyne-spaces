/**
 * Utility functions for Xyne AI Session Storage
 */

import type { AgentHistoryOutput, FormattedHistoryMessage, XyneAIOutput } from '../types';
import type { HistoryMessage } from './types';
import type { MessageData } from './customPostgresProvider';
import { convertAttachmentsToJAF } from '../utils/attachmentConverter.js';
import { fetchAttachmentsFromGCS } from '../../../services/attachmentRetrievalService.js';
import { logger } from '../../../utils/logger.js';

/**
 * Format history messages for JAF agent context
 * 
 * Converts stored messages to JAF format:
 * - user: { query, timestamp, attachments? } → "query text" + JAF attachments
 * - assistant: { summary, keyPoints } → { summary, keypoints, citations }
 *
 * NOTE: Attachments are already fetched from GCS by convertMessagesToHistory()
 * and are in base64 AttachmentData[] format. This function converts them to JAF format.
 */
export function formatHistoryForJAF(history: HistoryMessage[]): FormattedHistoryMessage[] {
  const messages: FormattedHistoryMessage[] = [];

  for (const msg of history) {
    if (msg.role === 'USER') {
      const content = msg.content;
      const queryText = typeof content === 'string' ? content : content.query;

      // Convert attachments to JAF format
      const attachments = typeof content !== 'string' && content.attachments
        ? convertAttachmentsToJAF(content.attachments)
        : undefined;

      messages.push({
        role: 'user',
        content: queryText,
        ...(attachments && attachments.length > 0 && { attachments }),
      });
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
 *
 * IMPORTANT: This function fetches attachments from GCS if they exist.
 * Attachments are stored in WorkflowStep.attachment column as metadata,
 * and this function retrieves the actual files from GCS and converts to base64.
 */
export async function convertMessagesToHistory(messages: MessageData[]): Promise<HistoryMessage[]> {
  const history: HistoryMessage[] = [];

  for (const msg of messages) {
    if (msg.role === 'USER') {
      const content = msg.content as { query: string; timestamp: string };

      // Retrieve attachments (from Redis cache or GCS)
      let attachments;
      if (msg.attachment && msg.attachment.length > 0) {
        try {
          attachments = await fetchAttachmentsFromGCS(msg.attachment, msg.sessionId);
        } catch (error) {
          logger.error(`[Utils] [${msg.sessionId}] Failed to retrieve attachments for message ${msg.messageId}:`, error);
          logger.warn(`[Utils] [${msg.sessionId}] Continuing without attachments for message ${msg.messageId}`);
        }
      }

      history.push({
        role: 'USER',
        content: {
          query: content.query,
          timestamp: content.timestamp,
          ...(attachments && attachments.length > 0 && { attachments }),
        },
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
