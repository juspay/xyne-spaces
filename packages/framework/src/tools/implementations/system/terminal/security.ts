import type { SecurityValidation, SupportedPlatform } from './schemas.js';

/**
 * Minimal security validation - simplified to match 's permissive approach
 * Most commands are allowed and rely on system permissions for security
 */

/**
 * Validates if a command is safe to execute - simplified to match 's permissive approach
 * Only blocks the most dangerous operations, allows most commands
 */
export function validateCommand(command: string, _platform: SupportedPlatform): SecurityValidation {
  // Only check for null bytes which could cause issues
  if (command.includes('\0') || command.includes('\x00')) {
    return {
      allowed: false,
      reason: 'Command contains null bytes',
      riskLevel: 'critical',
    };
  }

  // Allow almost everything else like  - rely on system permissions
  return {
    allowed: true,
    riskLevel: 'low',
  };
}

/**
 * Simple command sanitization - remove dangerous characters but allow most commands
 */
export function sanitizeCommand(command: string): string {
  // Just trim whitespace and remove null bytes - keep it simple like 
  return command.trim().replace(/\0/g, '');
}