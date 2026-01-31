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
 * @returns Standardized Superposition context object
 * 
 * @example
 * ```typescript
 * const context = createBlockingContext({
 *   sourceName: 'zoho-local-test',
 *   email: 'user@example.com'
 * });
 * // Returns: { sourceName: 'zoho-local-test', email: 'user@example.com', domain: 'example.com' }
 * ```
 */
export function createBlockingContext(params: {
  sourceName: string;
  email?: string | null;
  domain?: string | null;
}): SuperpositionContext {
  const { sourceName, email, domain } = params;
  
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
  
  return context;
}
