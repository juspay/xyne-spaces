/**
 * libsignal (under Baileys) prints whole SessionEntry objects, privKey and rootKey included, via
 * console.info/warn on every session open/close (session_record.js). That bypasses our logger, so
 * swap those arguments for a placeholder. A runtime guard, not a pnpm patch: a patch would need
 * every image that installs from the root lockfile to copy `patches/`.
 */
const PLACEHOLDER = "[SessionEntry]";
const METHODS = ["debug", "info", "log", "warn", "error"] as const;
let installed = false;

function isSessionEntry(v: unknown): boolean {
  return typeof v === "object" && v !== null && v.constructor?.name === "SessionEntry";
}

export function redactLibsignalSessionLogs(): void {
  if (installed) return;
  installed = true;
  for (const method of METHODS) {
    const original = console[method].bind(console);
    console[method] = (...args: unknown[]) => original(...args.map((a) => (isSessionEntry(a) ? PLACEHOLDER : a)));
  }
}
