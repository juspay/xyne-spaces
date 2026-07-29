/**
 * Zoho Flow - Fetch missing email fields from Zoho API
 * Zoho stopped sending to/fromEmailAddress in webhooks, so we fetch them here
 */

import { ExternalSource } from '@prisma/client';
import { BaseFlow } from '../../core/baseFlow';
import { logger } from '../../../utils/logger';
import { ZohoService } from '@/services/zohoService';

export class ZohoFlow extends BaseFlow {
  /**
   * Preprocess Zoho payload to fetch missing email fields from Zoho API
   */
  async preprocess(rawPayload: any, source?: ExternalSource): Promise<any> {
    try {
      // Extract payload from array wrapper (Zoho sends array)
      const zohoEvent = Array.isArray(rawPayload)
        ? (rawPayload.length > 0 ? rawPayload[0] : null)
        : rawPayload;

      if (!zohoEvent?.payload) {
        return rawPayload;
      }

      const { eventType, payload } = zohoEvent;

      // Process both Ticket_Add and Ticket_Thread_Add events
      let ticketId: string;
      let threadId: string;
      let targetThread: any;

      if (eventType === 'Ticket_Add') {
        // For Ticket_Add, fields are in firstThread
        const firstThread = payload.firstThread;
        if (!firstThread) {
          return rawPayload;
        }
        ticketId = firstThread.ticketId || payload.id;
        threadId = firstThread.id;
        targetThread = firstThread;
      } else if (eventType === 'Ticket_Thread_Add') {
        // For Ticket_Thread_Add, fields are directly in payload
        ticketId = payload.ticketId;
        threadId = payload.id;
        targetThread = payload;
      } else {
        // Other event types - return as-is
        return rawPayload;
      }

      if (!ticketId || !threadId) {
        logger.warn('[ZohoFlow.preprocess] Missing ticketId or threadId', { ticketId, threadId });
        return rawPayload;
      }

      if (!source?.credentials) {
        logger.warn('[ZohoFlow.preprocess] No source credentials available');
        return rawPayload;
      }

      logger.info('[ZohoFlow.preprocess] Fetching email fields from Zoho API', { ticketId, threadId });

      const zohoService = ZohoService.fromEncryptedCredentials(source.credentials, source.id);
      const threadDetails = await zohoService.getThreadDetails(ticketId, threadId);

      if (!threadDetails) {
        logger.warn('[ZohoFlow.preprocess] Failed to fetch thread details');
        return rawPayload;
      }

      if (threadDetails.to) {
        targetThread.to = threadDetails.to;
      }

      if (threadDetails.fromEmailAddress) {
        targetThread.fromEmailAddress = threadDetails.fromEmailAddress;
      }

      if (threadDetails.cc) {
        targetThread.cc = threadDetails.cc;
      }

      if (threadDetails.bcc) {
        targetThread.bcc = threadDetails.bcc;
      }

      logger.info('[ZohoFlow.preprocess] Successfully fetched email fields from Zoho API');

      return Array.isArray(rawPayload) ? [zohoEvent] : zohoEvent;

    } catch (error: any) {
      const errorMessage = error?.message || error?.toString() || 'Unknown error';
      logger.error(`[ZohoFlow.preprocess] Error fetching required details: ${errorMessage}`);
      // Return with authenticated false to fail the flow
      return { authenticated: false };
    }
  }
}