/**
 * Shared file type constants for frontend and backend
 * Centralizes allowed file type definitions to prevent drift between
 * frontend and backend validation.
 */

/**
 * Certificate MIME types
 * Includes common MIME types for certificate and key files.
 * Note: Browsers often send 'application/octet-stream' for these files.
 */
export const CERTIFICATE_MIME_TYPES = [
  'application/x-pem-file',
  'application/x-x509-ca-cert',
  'application/pkix-cert',
  'application/pkix-crl',
  'application/pkcs8',
] as const;

/**
 * Certificate file extensions
 * .pem - PEM encoded certificate/key (most common)
 * .crt - Certificate file (common on Linux/Unix)
 * .key - Private key file (PEM format)
 * .cer - Certificate file (Microsoft/Windows)
 */
export const CERTIFICATE_EXTENSIONS = [
  '.pem',
  '.crt',
  '.key',
  '.cer',
] as const;

/**
 * Combined certificate file types for validation
 */
export const CERTIFICATE_FILE_TYPES = [
  ...CERTIFICATE_EXTENSIONS,
  ...CERTIFICATE_MIME_TYPES,
] as const;

/**
 * Image MIME types
 */
export const IMAGE_MIME_TYPES = [
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/svg+xml',
] as const;

/**
 * Document MIME types
 */
export const DOCUMENT_MIME_TYPES = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
] as const;

/**
 * Text file MIME types
 */
export const TEXT_MIME_TYPES = [
  'text/plain',
  'text/markdown',
  'text/csv',
  'application/json',
  'application/xml',
  'text/xml',
  'text/html',
  'text/yaml',
  'application/x-yaml',
] as const;

/**
 * Source code MIME types
 */
export const SOURCE_CODE_MIME_TYPES = [
  'text/x-python',
  'text/x-c',
  'text/x-csrc',
  'text/x-c++src',
  'text/x-c++',
  'text/x-java-source',
  'text/x-java',
  'text/x-go',
  'text/x-ruby',
  'application/x-ruby',
  'text/x-csharp',
  'application/sql',
  'text/x-sql',
  'text/typescript',
  'text/x-typescript',
  'text/tsx',
] as const;

/**
 * Archive MIME types
 */
export const ARCHIVE_MIME_TYPES = [
  'application/zip',
  'application/x-7z-compressed',
  'application/x-tar',
  'application/gzip',
] as const;

/**
 * Video MIME types
 */
export const VIDEO_MIME_TYPES = [
  'video/mp4',
  'video/webm',
  'video/avi',
  'video/quicktime',
] as const;

/**
 * Audio MIME types
 */
export const AUDIO_MIME_TYPES = [
  'audio/mpeg',
  'audio/wav',
  'audio/ogg',
  'audio/mp3',
] as const;

/**
 * Binary MIME types
 */
export const BINARY_MIME_TYPES = [
  'application/octet-stream',
  'binary/octet-stream',
] as const;

/**
 * All allowed MIME types for file uploads
 * This is the single source of truth for allowed file types
 */
export const ALLOWED_MIME_TYPES = [
  ...IMAGE_MIME_TYPES,
  ...DOCUMENT_MIME_TYPES,
  ...TEXT_MIME_TYPES,
  ...SOURCE_CODE_MIME_TYPES,
  ...ARCHIVE_MIME_TYPES,
  ...VIDEO_MIME_TYPES,
  ...AUDIO_MIME_TYPES,
  ...BINARY_MIME_TYPES,
  ...CERTIFICATE_MIME_TYPES,
] as const;

/**
 * Source code file extensions
 */
export const SOURCE_CODE_EXTENSIONS = [
  '.ts',
  '.tsx',
  '.py',
  '.rb',
  '.go',
  '.java',
  '.c',
  '.cpp',
  '.cs',
  '.sql',
  '.yml',
  '.yaml',
] as const;

/**
 * All allowed file types including extensions and MIME types
 * For use in frontend file input accept attributes and validation
 */
export const ALLOWED_FILE_TYPES = [
  ...ALLOWED_MIME_TYPES,
  ...SOURCE_CODE_EXTENSIONS,
  ...CERTIFICATE_EXTENSIONS,
] as const;

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
  '.js',
  '.jar',
  '.msi',
  '.dll',
  '.sys',
  '.bin',
  '.sh',
  '.ps1',
  '.php',
  '.asp',
  '.jsp',
] as const;
