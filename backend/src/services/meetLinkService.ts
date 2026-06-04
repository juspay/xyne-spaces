/**
 * Google Meet Link Extraction Service
 * Extracts Google Meet links from email body and sends metadata to SAM service
 */

import { logger } from '@/utils/logger';
import { config } from '@/config/env';
import axios from 'axios';

export interface MeetLinkMetadata {
  meetCode: string;
  meetUrl: string;
  xyneTicketId: string;
  threadId: string;
  workspaceId: string;
  zohoTicketId?: string;
  notificationUrl?: string;
}

export interface SamMeetMetaDataPayload {
  xyneTicketId: string;
  threadId: string;
  zohoTicketId?: string;
  notificationUrl: string;
}

export interface SamMeetMetaPayload {
  server: string;
  data: SamMeetMetaDataPayload;
}

/**
 * Google Meet link patterns:
 * - https://meet.google.com/abc-defg-hij
 * - http://meet.google.com/abc-defg-hij
 * - meet.google.com/abc-defg-hij
 * 
 * Supports variable length segments 
 */
const GOOGLE_MEET_REGEX = /(?:https?:\/\/)?meet\.google\.com\/([a-z]+(?:-[a-z]+){2})/gi;

/**
 * Extract all Google Meet links from HTML or plain text body
 * @param body - Email body (HTML or plain text)
 * @returns Array of extracted meet link metadata
 */
export function extractMeetLinks(body: string): { meetCode: string; meetUrl: string }[] {
  if (!body || typeof body !== 'string') {
    return [];
  }

  const meetLinks: { meetCode: string; meetUrl: string }[] = [];
  const seenCodes = new Set<string>();

  let match;
  // Reset regex lastIndex for multiple calls
  GOOGLE_MEET_REGEX.lastIndex = 0;

  while ((match = GOOGLE_MEET_REGEX.exec(body)) !== null) {
    const meetCode = match[1].toLowerCase();

    // Avoid duplicates
    if (!seenCodes.has(meetCode)) {
      seenCodes.add(meetCode);
      meetLinks.push({
        meetCode,
        meetUrl: `https://meet.google.com/${meetCode}`,
      });
    }
  }

  return meetLinks;
}

/**
 * Generate the notification URL for SAM service callback
 * Format: ${BACKEND_URL}/api/meet/callback?xyneTicketId=...&workspaceId=...&threadId=...&meetCode=...
 */
export function generateNotificationUrl(
  xyneTicketId: string,
  workspaceId: string,
  threadId: string,
  meetCode: string
): string | null {
  const backendUrl = process.env.BACKEND_URL;
  if (!backendUrl) {
    logger.error('[MeetLinkService] Backend URL not configured - cannot generate notification URL');
    return null;
  }
  const params = new URLSearchParams({
    xyneTicketId,
    workspaceId,
    threadId,
    meetCode,
  });
  return `${backendUrl}/api/meet/callback?${params.toString()}`;
}

/**
 * Retry with exponential backoff
 */
async function withRetry<T>(
  fn: () => Promise<T>,
  options: { retries: number; delay: number; backoff: 'exponential' | 'linear' },
  context: string
): Promise<T> {
  let lastError: Error | undefined;

  for (let attempt = 1; attempt <= options.retries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      // Don't retry on 4xx errors (client errors)
      if (axios.isAxiosError(error) && error.response?.status && error.response.status >= 400 && error.response.status < 500) {
        throw error;
      }

      if (attempt < options.retries) {
        const delay = options.backoff === 'exponential'
          ? Math.min(options.delay * Math.pow(2, attempt - 1), 5000)
          : options.delay;
        logger.warn(`[MeetLinkService] ${context} - Attempt ${attempt} failed, retrying in ${delay}ms`, {
          error: lastError.message,
        });
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }

  throw lastError;
}

/**
 * Send meet metadata to SAM service
 * POST /sam/s2s/meet/{meetCode}/meta
 * Includes retry logic with exponential backoff for transient failures
 */
export async function sendMeetMetadataToSam(metadata: MeetLinkMetadata): Promise<boolean> {
  const endpoint = `${config.sam.baseUrl}/sam/s2s/meet/${metadata.meetCode}/meta`;

  // Generate notification URL with query params for callback identification (including workspaceId)
  const notificationUrl = generateNotificationUrl(
    metadata.xyneTicketId,
    metadata.workspaceId,
    metadata.threadId,
    metadata.meetCode
  );

  // Skip if notification URL could not be generated (missing BACKEND_URL config)
  if (!notificationUrl) {
    logger.warn('[MeetLinkService] Skipping SAM metadata - notification URL not available');
    return false;
  }

  const payload: SamMeetMetaPayload = {
    server: 'xyne-spaces',
    data: {
      xyneTicketId: metadata.xyneTicketId,
      threadId: metadata.threadId,
      ...(metadata.zohoTicketId && { zohoTicketId: metadata.zohoTicketId }),
      notificationUrl: notificationUrl,
    },
  };

  try {
    logger.info('[MeetLinkService] Sending meet metadata to SAM', {
      meetCode: metadata.meetCode,
      endpoint,
      xyneTicketId: metadata.xyneTicketId,
      threadId: metadata.threadId,
      zohoTicketId: metadata.zohoTicketId,
      notificationUrl,
    });

    logger.info('[MeetLinkService] SAM request payload', {
      meetCode: metadata.meetCode,
      payload,
    });

    const response = await withRetry(
      () => axios.post(endpoint, payload, {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Basic ${config.sam.apiKey}`,
        },
        timeout: 10000,
      }),
      { retries: 3, delay: 1000, backoff: 'exponential' },
      `SAM API call for ${metadata.meetCode}`
    );

    logger.info('[MeetLinkService] Successfully sent meet metadata to SAM', {
      meetCode: metadata.meetCode,
      status: response.status,
      statusText: response.statusText,
      xyneTicketId: metadata.xyneTicketId,
      responseData: response.data,
    });

    return true;
  } catch (error) {
    const errorDetails: Record<string, unknown> = {
      meetCode: metadata.meetCode,
      endpoint,
      xyneTicketId: metadata.xyneTicketId,
      threadId: metadata.threadId,
      zohoTicketId: metadata.zohoTicketId,
    };

    if (axios.isAxiosError(error)) {
      errorDetails.status = error.response?.status;
      errorDetails.statusText = error.response?.statusText;
      errorDetails.responseData = error.response?.data;
      errorDetails.errorCode = error.code;
      errorDetails.errorMessage = error.message;
    } else {
      errorDetails.error = error instanceof Error ? error.message : 'Unknown error';
    }

    logger.error('[MeetLinkService] Failed to send meet metadata to SAM after retries', errorDetails);
    // Don't throw - we don't want meet extraction failure to block email processing
    return false;
  }
}

/**
 * Process email body for meet links and send to SAM
 * Called after email/ticket creation
 * @param workspaceId - Workspace ID for the callback URL
 * @param zohoTicketId - Optional Zoho ticket ID. If not provided, the field is omitted from the SAM payload.
 */
export async function processMeetLinksFromEmail(
  emailBody: string,
  xyneTicketId: string,
  workspaceId: string,
  threadId: string,
  zohoTicketId?: string
): Promise<{ processed: number; meetCodes: string[] }> {
  const meetLinks = extractMeetLinks(emailBody);

  if (meetLinks.length === 0) {
    logger.debug('[MeetLinkService] No Google Meet links found in email body');
    return { processed: 0, meetCodes: [] };
  }

  logger.info('[MeetLinkService] Found Google Meet links in email', {
    count: meetLinks.length,
    meetCodes: meetLinks.map(l => l.meetCode),
    xyneTicketId,
    workspaceId,
  });

  // Process meet links in parallel for better performance
  const results = await Promise.allSettled(
    meetLinks.map(meetLink =>
      sendMeetMetadataToSam({
        meetCode: meetLink.meetCode,
        meetUrl: meetLink.meetUrl,
        xyneTicketId,
        workspaceId,
        threadId,
        zohoTicketId,
      })
    )
  );

  const processedCodes: string[] = [];
  results.forEach((result, index) => {
    if (result.status === 'fulfilled' && result.value === true) {
      processedCodes.push(meetLinks[index].meetCode);
    }
  });

  return {
    processed: processedCodes.length,
    meetCodes: processedCodes,
  };
}

export const meetLinkService = {
  extractMeetLinks,
  sendMeetMetadataToSam,
  processMeetLinksFromEmail,
};
