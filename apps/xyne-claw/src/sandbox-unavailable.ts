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
 * The whole path is gated behind SANDBOX_UNAVAILABLE_DEFER, now default ON —
 * set it to "false" to restore the pre-existing read-only fallback.
 *
 * See apps/xyne-claw/docs/sbx-availability-signal.md for the design rationale.
 */

// The token, the flag and the emit/match helpers live in xyne-claw-shared next
// to the tool that EMITS them — one definition, so the wire contract can't drift
// between the package that writes it and this runtime that reads it. Re-exported
// here so existing importers of this module keep working.
export {
  SANDBOX_UNAVAILABLE_SENTINEL,
  isSandboxUnavailableDeferEnabled,
  isSandboxUnavailable,
} from "xyne-claw-shared";
import { SANDBOX_UNAVAILABLE_SENTINEL as SENTINEL } from "xyne-claw-shared";

export class SandboxUnavailableError extends Error {
  constructor(public readonly detail?: string) {
    super(detail ?? SENTINEL);
    this.name = "SandboxUnavailableError";
  }
}
