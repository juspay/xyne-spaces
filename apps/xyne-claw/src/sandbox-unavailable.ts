/**
 * Sandbox-capacity deferral signal.
 *
 * When an agent needs a WRITABLE dev sandbox and the agent-sandbox operator
 * cannot bind a SandboxClaim right now (warm pool empty AND the kata node pool
 * at max nodes), `sandbox-repo-setup` emits a stable `sandbox_unavailable`
 * sentinel instead of silently substituting a read-only session. The custom-tool
 * runner (which otherwise stringifies every tool throw and hands it back to the
 * LLM — letting the agent "succeed" with an unusable sandbox, give up, and end
 * the run with NO retry signal, forcing a human to re-tag) rethrows THIS typed
 * error so it reaches run.ts's terminal catch. There the run ends with
 * `error: "sandbox_unavailable"`, which run-recovery classifies and defers,
 * re-dispatching the same run until a sandbox binds — no re-tag needed.
 *
 * The whole path is gated behind SANDBOX_UNAVAILABLE_DEFER (default off) so the
 * change is a no-op until it has been validated on-cluster and the flag flipped.
 *
 * See apps/xyne-claw/docs/sbx-availability-signal.md for the design rationale.
 */

/** Stable protocol token shared (as a bare literal, mirroring "session_locked")
 *  across the shared sandbox tool, this runtime, and claw-auth run-recovery. */
export const SANDBOX_UNAVAILABLE_SENTINEL = "sandbox_unavailable";

/** Master gate for the defer-and-auto-resume path. Default OFF: with the flag
 *  unset, `sandbox-repo-setup` keeps today's read-only fallback and nothing in
 *  this module is ever thrown. */
export function isSandboxUnavailableDeferEnabled(): boolean {
  return process.env["SANDBOX_UNAVAILABLE_DEFER"] === "true";
}

export class SandboxUnavailableError extends Error {
  constructor(public readonly detail?: string) {
    super(detail ?? SANDBOX_UNAVAILABLE_SENTINEL);
    this.name = "SandboxUnavailableError";
  }
}
