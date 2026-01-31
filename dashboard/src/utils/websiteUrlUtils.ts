// ============================================================================
// URL PARSER UTILITIES
// ============================================================================
// Utilities for parsing and extracting parameters from text and building URLs
// Used primarily for dynamic URL generation for tools like MIMIR
// ============================================================================

export interface ExtractedParams {
  orderId?: string;
  merchantId?: string;
}

/**
 * Extract order_id and merchant_id from selected text
 *
 * Supports various formats:
 * - "order_id: 1f07e4847b74986c5aa9 merchant_id: bigbasket"
 * - "order_id=1f07e4847b74986c5aa9&merchant_id=bigbasket"
 * - URL query parameters: "?order_id=123&merchant_id=abc"
 *
 * @param text - The text to extract parameters from
 * @returns Object containing extracted order_id and merchant_id (if found)
 */
export const extractParams = (text: string): ExtractedParams => {
  const params: ExtractedParams = {};

  // Pattern 1: "Order Id:" or "order_id:" or "orderId:" (with flexible spacing and separators)
  // Handles: "Order Id: 123", "order_id=123", "Order Id:\n123", etc.
  const orderIdMatch = text.match(/order[\s_-]*id[:\s=]+([a-zA-Z0-9_-]+)/i);
  if (orderIdMatch && orderIdMatch[1]) {
    params.orderId = orderIdMatch[1].trim();
  }

  // Pattern 2: "Merchant Id:" or "merchant_id:" or "merchantId:" (with flexible spacing and separators)
  // Handles: "Merchant Id: bigbasket", "merchant_id=bigbasket", "Merchant Id:\nbigbasket", etc.
  const merchantIdMatch = text.match(/merchant[\s_-]*id[:\s=]+([a-zA-Z0-9_-]+)/i);
  if (merchantIdMatch && merchantIdMatch[1]) {
    params.merchantId = merchantIdMatch[1].trim();
  }

  // Pattern 3: If no keywords found, try to extract from URL-like patterns
  if (!params.orderId) {
    const urlOrderMatch = text.match(/[&?]order_id=([a-zA-Z0-9_-]+)/);
    if (urlOrderMatch && urlOrderMatch[1]) {
      params.orderId = urlOrderMatch[1].trim();
    }
  }

  if (!params.merchantId) {
    const urlMerchantMatch = text.match(/[&?]merchant_id=([a-zA-Z0-9_-]+)/);
    if (urlMerchantMatch && urlMerchantMatch[1]) {
      params.merchantId = urlMerchantMatch[1].trim();
    }
  }

  return params;
};

/**
 * Build MIMIR URL with extracted parameters from selected text
 *
 * Constructs a search URL with order_id and merchant_id parameters.
 * Requires BOTH parameters to build dynamic URL - falls back to base URL otherwise.
 *
 * @param selectedText - The text to extract parameters from
 * @param baseUrl - Optional base URL (defaults to localhost:9033)
 * @returns Constructed MIMIR URL with query parameters if both params found, otherwise base URL
 */
export const buildMimirUrl = (selectedText: string, baseUrl?: string): string => {
  const params = extractParams(selectedText);
  const url = baseUrl || 'http://localhost:9033/';

  // Only build dynamic URL if we have both orderId and merchantId
  if (params.orderId && params.merchantId) {
    // Map from camelCase to snake_case for API using append (avoids object literal naming issues)
    const queryParams = new URLSearchParams();
    queryParams.append('searchType', 'OrderIdBased');
    queryParams.append('order_id', params.orderId); // Map orderId → order_id
    queryParams.append('merchant_id', params.merchantId); // Map merchantId → merchant_id

    return `${url}?${queryParams.toString()}`;
  }

  // Fallback: return base URL if we don't have both parameters
  return url;
};

/**
 * Build Google search URL with selected text
 */
export const buildGoogleUrl = (selectedText: string): string => {
  return `https://www.google.com/search?q=${encodeURIComponent(selectedText)}`;
};

/**
 * Build ChatGPT URL with selected text
 */
export const buildChatGPTUrl = (selectedText: string): string => {
  return `https://chat.openai.com/?prompt=${encodeURIComponent(selectedText)}`;
};
