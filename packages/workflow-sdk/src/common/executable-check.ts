/**
 * Executable upload safety check.
 *
 * Allow-by-default with a deny-list of known dangerous types — covers the
 * common attack surface (native binaries, scripts that auto-run, installers,
 * macro-enabled Office docs) without forcing workflow authors to enumerate
 * every safe MIME type.
 *
 * Two checks run in parallel so spoofed MIME types alone can't bypass:
 *   1. MIME type matches the deny-list
 *   2. Filename extension matches the deny-list
 *
 * Either match blocks the upload. To accept executables (e.g. a security-
 * analysis workflow that intentionally examines binaries), the host opts
 * in via `RuntimeOptions.allowExecutableUploads = true`.
 */

/**
 * MIME types treated as executable / unsafe (lowercase — input is also
 * lowercased before comparison).
 */
export const BLOCKED_EXECUTABLE_MIME_TYPES: ReadonlySet<string> = new Set([
  // Native binaries
  'application/x-msdownload',
  'application/x-msdos-program',
  'application/x-executable',
  'application/x-mach-binary',
  'application/vnd.microsoft.portable-executable',
  'application/x-msi',
  'application/x-ms-installer',
  // Shell + Windows scripts
  'application/x-sh',
  'application/x-shellscript',
  'application/x-bat',
  'application/x-csh',
  'application/x-cmd',
  'application/x-msmetafile',
  // JavaScript / ECMAScript
  'text/javascript',
  'application/javascript',
  'application/ecmascript',
  'application/x-javascript',
  // Java / Flash
  'application/java-archive',
  'application/x-java-archive',
  'application/x-java-jnlp-file',
  'application/x-shockwave-flash',
  // Installer / package formats that bundle executables
  'application/vnd.android.package-archive',
  'application/x-debian-package',
  'application/x-rpm',
  // Macro-enabled Office documents (lowercased — IANA tokens are case-insensitive)
  'application/vnd.ms-word.document.macroenabled.12',
  'application/vnd.ms-word.template.macroenabled.12',
  'application/vnd.ms-excel.sheet.macroenabled.12',
  'application/vnd.ms-excel.template.macroenabled.12',
  'application/vnd.ms-excel.addin.macroenabled.12',
  'application/vnd.ms-excel.sheet.binary.macroenabled.12',
  'application/vnd.ms-powerpoint.presentation.macroenabled.12',
  'application/vnd.ms-powerpoint.template.macroenabled.12',
  'application/vnd.ms-powerpoint.addin.macroenabled.12',
]);

/**
 * File extensions treated as executable / unsafe (case-insensitive, no dot).
 * The check uses the LAST extension so `report.exe.txt` is treated as text
 * (Windows shows the trailing extension, which is what the user actually sees).
 */
export const BLOCKED_EXECUTABLE_EXTENSIONS: ReadonlySet<string> = new Set([
  // Windows
  'exe', 'msi', 'com', 'scr', 'cmd', 'bat', 'ps1', 'psm1',
  'vbs', 'vbe', 'wsf', 'wsh', 'hta', 'cpl', 'lnk',
  'dll', 'sys', 'drv', 'ocx',
  // macOS / Unix
  'app', 'dmg', 'pkg',
  'sh', 'bash', 'zsh', 'fish', 'csh', 'ksh', 'command', 'tool',
  // Java / Flash
  'jar', 'war', 'jnlp', 'swf',
  // Mobile installers
  'apk', 'ipa', 'xap',
  // Linux installers
  'deb', 'rpm', 'run', 'bin',
  // JavaScript (auto-executes in browser / Node contexts)
  'js', 'mjs', 'cjs',
  // Macro-enabled Office
  'docm', 'dotm', 'xlsm', 'xltm', 'xlam', 'xlsb',
  'pptm', 'potm', 'ppam', 'ppsm', 'sldm',
]);

/**
 * Extract the lowercase extension (no dot) from a filename, or '' if none.
 * A leading dot doesn't count — `.bashrc` has no extension, not "bashrc".
 */
export function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.');
  if (dot <= 0 || dot === name.length - 1) return '';
  return name.slice(dot + 1).toLowerCase();
}

/**
 * Returns a human-readable reason if the file should be blocked as
 * executable, or `null` if it's safe.
 *
 * Always check both the MIME type and the filename — clients can spoof one
 * but rarely both. This is defense-in-depth, not authoritative malware
 * detection (run real AV at the storage layer for that).
 */
export function isExecutable(mimeType: string, name: string): string | null {
  if (BLOCKED_EXECUTABLE_MIME_TYPES.has(mimeType.toLowerCase())) {
    return `Executable MIME type "${mimeType}" is not allowed.`;
  }
  const ext = extensionOf(name);
  if (ext && BLOCKED_EXECUTABLE_EXTENSIONS.has(ext)) {
    return `Files with .${ext} extension are not allowed.`;
  }
  return null;
}
