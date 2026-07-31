/**
 * Project utility functions shared between backend and dashboard
 */

/**
 * Sanitizes a project code by:
 * - Converting to uppercase
 * - Keeping only alphanumeric characters (letters A-Z and numbers 0-9)
 * - Truncating to max 10 characters
 *
 * @param input - Raw project code input
 * @returns Sanitized project code
 */
export function sanitizeProjectCode(input: string): string {
  return input
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 10);
}

/**
 * Validates that a project code meets the minimum requirements
 * - Must be at least 2 alphanumeric characters
 *
 * @param code - Sanitized project code
 * @returns Whether the code is valid
 */
export function isValidProjectCode(code: string): boolean {
  return code.length >= 2;
}
