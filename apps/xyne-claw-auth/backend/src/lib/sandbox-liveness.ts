import { CONFIG } from "../config.js";
import { createLogger } from "../logger.js";
import { markSandboxArtifactsStale, SANDBOX_ARTIFACT_KINDS, SANDBOX_ID_RE } from "./conversation-artifacts.js";

const log = createLogger("sandbox-liveness");

/** How long a sandbox's last check is trusted before it is asked about again. */
export const LIVENESS_RECHECK_MS = 5 * 60 * 1000;
/** Matches xyne-claw's MAX_LIVENESS_IDS. */
const MAX_IDS_PER_CHECK = 50;

/** sandboxId → when it was last sent for a check (per pod). */
const lastChecked = new Map<string, number>();

/** Test hook. */
export function resetSandboxLivenessCache(): void {
  lastChecked.clear();
}

interface SandboxArtifactLike {
  kind: string;
  refService: string;
  refId: string;
  status: string;
}

/**
 * XYNE-66339: ask xyne-claw whether the sandboxes behind ACTIVE preview /
 * code-changes rows still exist, and mark ended ones STALE. Covers sandboxes
 * that idled out, passed their deadline or lost their pod, none of which call
 * `sandbox-destroy`.
 *
 * Run it without awaiting: marking calls signalArtifacts, so an open pane
 * refetches and shows "This sandbox has ended" without delaying the list.
 * Every failure is logged and leaves rows unchanged.
 */
export async function refreshSandboxLiveness(rows: SandboxArtifactLike[], now = Date.now()): Promise<void> {
  for (const [id, at] of lastChecked) if (now - at >= LIVENESS_RECHECK_MS) lastChecked.delete(id);
  const due = [
    ...new Set(
      rows
        .filter((r) => r.refService === "CLAW" && r.status === "ACTIVE" && SANDBOX_ARTIFACT_KINDS.includes(r.kind))
        .map((r) => r.refId)
        .filter((id) => SANDBOX_ID_RE.test(id) && !lastChecked.has(id)),
    ),
  ].slice(0, MAX_IDS_PER_CHECK);
  if (due.length === 0) return;
  for (const id of due) lastChecked.set(id, now);

  try {
    const res = await fetch(`${CONFIG.xyneClawUrl}/internal/sandboxes/liveness`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-s2s-key": CONFIG.xyneClawS2sKey },
      body: JSON.stringify({ sandboxIds: due }),
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) throw new Error(`status ${res.status}`);
    const { liveness } = (await res.json()) as { liveness?: Record<string, unknown> };
    const ended = due.filter((id) => liveness?.[id] === "ended");
    if (ended.length > 0) await markSandboxArtifactsStale(ended);
  } catch (err) {
    log.warn(`sandbox liveness check skipped: ${err instanceof Error ? err.message : String(err)}`);
  }
}
