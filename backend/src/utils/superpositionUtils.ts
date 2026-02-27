/**
 * Superposition Utility Functions
 * Shared utilities for creating consistent Superposition context structures
 */

import { SuperpositionContext } from '@/services/superpositionClient';

/**
 * Extract domain from email address
 * Handles formats like "Name <email@domain.com>" or just "email@domain.com"
 */
export function extractDomainFromEmail(email: string | null | undefined): string | null {
  if (!email || typeof email !== 'string') {
    return null;
  }
  
  // Extract email from format like "Name <email@domain.com>" or just "email@domain.com"
  const emailMatch = email.match(/<([^>]+@[^>]+)>/) || email.match(/([^\s<>]+@[^\s<>]+)/);
  if (emailMatch) {
    const emailAddress = emailMatch[1] || emailMatch[0];
    const parts = emailAddress.split('@');
    if (parts.length === 2) {
      return parts[1].toLowerCase();
    }
  }
  return null;
}

/**
 * Create standardized blocking context for Superposition checks
 * Ensures consistent context structure across all services
 * 
 * @param params - Parameters for context creation
 * @param params.sourceName - External source name (e.g., "zoho-local-test")
 * @param params.email - Email address (optional, can be empty string)
 * @param params.domain - Domain extracted from email (optional, will be extracted if not provided)
 * @param params.emailSubject - Email subject line (optional, useful for subject-based filtering)
 * @returns Standardized Superposition context object
 * 
 * @example
 * ```typescript
 * const context = createBlockingContext({
 *   sourceName: 'zoho-local-test',
 *   email: 'user@example.com',
 *   emailSubject: 'Support Request: Login Issue'
 * });
 * // Returns: { sourceName: 'zoho-local-test', email: 'user@example.com', domain: 'example.com', emailSubject: 'Support Request: Login Issue' }
 * ```
 */
export function createBlockingContext(params: {
  sourceName: string;
  email?: string | null;
  domain?: string | null;
  emailSubject?: string | null;
}): SuperpositionContext {
  const { sourceName, email, domain, emailSubject } = params;

  const context: SuperpositionContext = {
    sourceName,
  };
  
  // Always include email if provided (even if empty string)
  // This ensures consistent evaluation in Superposition
  if (email !== undefined && email !== null) {
    context.email = email;
    
    // Extract domain if not provided
    const extractedDomain = domain || extractDomainFromEmail(email);
    if (extractedDomain) {
      context.domain = extractedDomain;
    }
  } else if (domain) {
    // Include domain even if email is not provided
    context.domain = domain;
  }

  // Include email subject if provided (useful for filtering/blocking based on subject patterns)
  if (emailSubject !== undefined && emailSubject !== null) {
    context.emailSubject = emailSubject;
  }

  return context;
}
