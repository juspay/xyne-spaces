/**
 * The `sandbox_unavailable` wire contract — ONE definition shared by every hop.
 *
 * When a WRITABLE dev sandbox can't be provisioned (warm pool empty AND the kata
 * node pool at max nodes), `sandbox-repo-setup` emits this sentinel instead of
 * silently substituting a read-only session. The signal then crosses three
 * boundaries: shared tool → xyne-claw custom-tools (rethrows a typed error) →
 * xyne-claw run.ts (terminal callback `error: "sandbox_unavailable"`) →
 * claw-auth run-recovery (defers + re-dispatches until a SandboxClaim binds).
 *
 * Emitter and matcher used to hand-copy the same string literal across a package
 * boundary, so rewording the user-facing message would have silently broken the
 * whole defer path with nothing to catch it. Both sides now go through the
 * helpers here: `formatSandboxUnavailable` writes it, `isSandboxUnavailable`
 * reads it, and the token itself is asserted by tests.
 *
 * See apps/xyne-claw/docs/sbx-availability-signal.md.
 */

/** Stable protocol token (mirrors the bare "session_locked" convention). */
export const SANDBOX_UNAVAILABLE_SENTINEL = "sandbox_unavailable";

/**
 * Master gate for the defer-and-auto-resume path. Default ON.
 *
 * Shipped default-OFF while one link was unvalidated: whether a throw from the
 * tool actually reaches run.ts's terminal catch. It does — the sandbox subagent
 * was removed 2026-06-14 and sandbox tools mount parent-direct (routes/run.ts),
 * so nothing swallows it. With that resolved, defaulting off only preserved the
 * original defect: a write-needing agent silently handed a READ-ONLY sandbox,
 * concluding it cannot work and ending with no retry signal, forcing a re-tag.
 *
 * Set SANDBOX_UNAVAILABLE_DEFER=false to restore the old read-only fallback.
 * Any other value (unset, "true", anything else) leaves the defer path on.
 */
export function isSandboxUnavailableDeferEnabled(): boolean {
  return process.env["SANDBOX_UNAVAILABLE_DEFER"] !== "false";
}

/**
 * Build the tool result that carries the signal. The `Error: ` prefix matches
 * what the custom-tool runner produces for thrown tools, so a caller that only
 * looks at the text sees a normal error string.
 */
export function formatSandboxUnavailable(detail: string): string {
  return (
    `Error: ${SANDBOX_UNAVAILABLE_SENTINEL}: the writable dev sandbox could not be provisioned ` +
    `(${detail}). This run is being queued and will resume automatically when capacity frees — ` +
    `no need to re-tag.`
  );
}

/**
 * Does a tool result carry the signal? Deliberately matches on the token alone
 * (not the surrounding prose or the `Error: ` prefix) so the user-facing wording
 * can change freely without breaking the defer path.
 */
export function isSandboxUnavailable(result: string): boolean {
  return result.includes(SANDBOX_UNAVAILABLE_SENTINEL);
}
