/**
 * Vespa-based Duplicate Detector for Tickets
 * Uses Vespa search to find duplicate tickets based on subject, channel, and email domain
 */

import { vespaClient } from '@/services/vespaSearch';
import { convert } from 'html-to-text';
import { type VespaTicketDocument, type VespaSearchResponse } from '@/vespa/src/types';
import { logger } from '@/utils/logger';
import { repositories } from '@/database/repositories';

export interface DuplicateMatch {
  conversationId: string;
  ticketId: string;
  subject: string;
  createdAt: Date;
}

export interface DuplicateDetectionResult {
  isDuplicate: boolean;
  match?: DuplicateMatch;
  reason?: string;
}

/**
 * Extract domain from email address
 */
function getEmailDomain(email: string): string {
  if (!email || !email.includes('@')) return '';
  return email.split('@')[1].toLowerCase().trim();
}

/**
 * Extract pure email address from "Name <email>" format
 */
function extractEmailFromAddress(address: string): string {
  if (!address) return '';
  
  // If already just an email, return it
  if (address.includes('<') && address.includes('>')) {
    const match = address.match(/<([^>]+)>/);
    return match ? match[1].trim() : address.trim();
  }
  
  // If no angle brackets, check if it looks like an email
  if (address.includes('@')) {
    return address.trim();
  }
  
  return '';
}

/**
 * Normalize email subject by removing prefixes and normalizing punctuation
 */
function normalizeEmailSubject(subject: string): string {
  if (!subject) return '';
  
  // Convert HTML to plain text
  const plainText = convert(subject, {
    wordwrap: false,
    preserveNewlines: true,
    selectors: [
      { selector: 'a', options: { ignoreHref: true } },
      { selector: 'img', format: 'skip' }
    ]
  });
  
  return plainText
    .replace(/^(RE:|Re:|Fwd:|FWD:|FW:|Fw:|Re: Re:)\s*/i, '') // Remove email prefixes
    .replace(/##\s*\d+\s*##/g, '') // Remove ticket numbers
    .replace(/[-_]/g, ' ') // Normalize punctuation
    .replace(/\s+/g, ' ') // Remove extra whitespace
    .trim()
    .toLowerCase();
}

/**
 * Check if a ticket matches all criteria
 */
async function checkTicketMatch(
  ticket: VespaTicketDocument,
  channelId: string,
  emailFrom: string,
  normalizedSubject: string,
  incomingEmailDomain: string
): Promise<boolean> {
  // Skip terminal tickets — both COMPLETED (resolved) and CANCELLED (invalid/rejected)
  // should not accept new emails via auto-merge.
  if (ticket.status === 'COMPLETED' || ticket.status === 'CANCELLED') return false;

  // Check subject match
  if (normalizeEmailSubject(ticket.title) !== normalizedSubject) return false;

  // Check channel match
  const ticketData = ticket as any;
  if (ticketData.channelId !== channelId) return false;

  // Fetch first email from email table
  const firstEmail = await repositories.emails.findFirstByConversationId(ticket.convId);
  if (!firstEmail) return false;

  const storedEmail = extractEmailFromAddress(firstEmail.from);
  const incomingEmail = extractEmailFromAddress(emailFrom);

  // Check email match from email table
  if (incomingEmail.toLowerCase() !== storedEmail.toLowerCase()) return false;

  // Check domain match - use extracted email for consistent domain extraction
  const firstEmailDomain = getEmailDomain(storedEmail);

  return Boolean(incomingEmailDomain && firstEmailDomain && incomingEmailDomain === firstEmailDomain);
}

/**
 * Find duplicate ticket using Vespa search
 * 
 * Matches tickets with:
 * - Same normalized subject
 * - Same channel
 * - Same sender email
 * - Same email domain (domain of first email in conversation)
 * - Status NOT COMPLETED
 * 
 * @param channelId - Channel to search in
 * @param emailFrom - Sender email address
 * @param emailSubject - Current email subject
 * @param excludeTicketId - Ticket ID to exclude (optional)
 */
export async function findDuplicateEmailConversation(
  channelId: string,
  emailFrom: string,
  emailSubject: string,
  excludeTicketId?: string
): Promise<DuplicateDetectionResult> {
  // Validate inputs
  if (!emailFrom?.includes('@')) {
    return { isDuplicate: false, reason: 'Invalid email address' };
  }

  const normalizedSubject = normalizeEmailSubject(emailSubject);
  if (!normalizedSubject) {
    return { isDuplicate: false, reason: 'Empty subject after normalization' };
  }

  // Extract clean email address from "Name <email>" format for consistent comparison
  const extractedEmailFrom = extractEmailFromAddress(emailFrom);
  const incomingEmailDomain = getEmailDomain(extractedEmailFrom);

  // Build and execute Vespa query with channelId filter for better performance
  const excludeCondition = excludeTicketId ? ` and docId != "${excludeTicketId}"` : '';
  const yql = `select * from sources ticket where docType contains "ticket" and title contains "${normalizedSubject}" and channelId contains "${channelId}"${excludeCondition}`;

  logger.info('[VESPA_DUPLICATE_SEARCH]', { channelId, emailFrom, normalizedSubject, excludeTicketId });

  try {
    const response = await vespaClient.search<VespaSearchResponse>({
      yql,
      hits: 100,
      offset: 0,
      'ranking.profile': 'default_native',
      'ranking.listFeatures': false,
      timeout: '5s',
    });

    const hits = response.root?.children || [];
    logger.info(`[VESPA_DUPLICATE_SEARCH] ${hits.length} candidates returned`);

    // Check each ticket for match
    for (const hit of hits) {
      const ticket = hit.fields as VespaTicketDocument;
      if (!ticket) continue;

      const isMatch = await checkTicketMatch(
        ticket,
        channelId,
        extractedEmailFrom,
        normalizedSubject,
        incomingEmailDomain
      );

      if (isMatch) {
        const firstEmail = await repositories.emails.findFirstByConversationId(ticket.convId);
        const firstEmailDomain = getEmailDomain(firstEmail?.from || '');

        logger.info('[VESPA_DUPLICATE_MATCH] Found match', {
          ticketId: ticket.docId,
          conversationId: ticket.convId,
          subject: ticket.title,
          domain: firstEmailDomain,
        });

        return {
          isDuplicate: true,
          match: {
            conversationId: ticket.convId,
            ticketId: ticket.docId,
            subject: ticket.title,
            createdAt: new Date(ticket.createdAt),
          },
        };
      }
    }

    logger.info('[VESPA_DUPLICATE_NO_MATCH] No matching ticket found');
    return { isDuplicate: false, reason: 'No matching ticket found with domain match' };
  } catch (error) {
    logger.error('Vespa duplicate search failed', {
      error: error instanceof Error ? error.message : 'Unknown error',
      channelId,
      emailSubject,
    });
    return { isDuplicate: false, reason: 'Vespa search failed, allowing creation' };
  }
}