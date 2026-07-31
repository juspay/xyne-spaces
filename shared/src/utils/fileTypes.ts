/**
 * Shared file type constants for file upload validation.
 * Uses a blocklist approach — all file types are allowed except dangerous extensions.
 */

/**
 * Dangerous file extensions that should be rejected
 */
export const DANGEROUS_EXTENSIONS = [
  '.exe',
  '.bat',
  '.cmd',
  '.com',
  '.pif',
  '.scr',
  '.vbs',
  '.jar',
  '.msi',
  '.dll',
  '.sys',
  '.bin',
  '.ps1',
  '.asp',
  '.jsp',
] as const;
