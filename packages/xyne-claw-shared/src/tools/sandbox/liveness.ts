import { getSandboxLiveness, type SandboxLiveness } from "@xyne/kata-sdk";

/** A sandbox id is a Kubernetes object name (same check as claw-auth). */
const SANDBOX_ID_RE = /^[A-Za-z0-9][A-Za-z0-9-]{0,62}$/;

export const MAX_LIVENESS_IDS = 50;
const CHECK_TIMEOUT_MS = 3_000;
const LIVENESS_CONCURRENCY = 8;

export type { SandboxLiveness };

/**
 * XYNE-66339: whether each sandbox still exists, for claw-auth's ended-preview
 * check. The namespace comes from the platform env (KATA_NAMESPACE is
 * platform-only), never from the caller. Invalid ids are dropped; a lookup that
 * fails or is not done within CHECK_TIMEOUT_MS of the call reports `unknown`.
 */
export async function checkSandboxLiveness(
  sandboxIds: readonly unknown[],
  deps: { lookup?: (id: string, namespace: string) => Promise<SandboxLiveness>; namespace?: string } = {},
): Promise<Record<string, SandboxLiveness>> {
  const namespace = deps.namespace ?? (process.env["KATA_NAMESPACE"] || "xyne-apps");
  const lookup = deps.lookup ?? ((id: string, ns: string) => getSandboxLiveness(id, { namespace: ns }));
  const ids = [
    ...new Set(sandboxIds.filter((id): id is string => typeof id === "string" && SANDBOX_ID_RE.test(id.trim())).map((id) => id.trim())),
  ].slice(0, MAX_LIVENESS_IDS);
  const out: Record<string, SandboxLiveness> = Object.fromEntries(ids.map((id) => [id, "unknown" as const]));
  let timer: ReturnType<typeof setTimeout> | undefined;
  let expired = false;
  const deadline = new Promise<SandboxLiveness>((resolve) => {
    timer = setTimeout(() => {
      expired = true;
      resolve("unknown");
    }, CHECK_TIMEOUT_MS);
  });
  let next = 0;
  const worker = async (): Promise<void> => {
    while (!expired && next < ids.length) {
      const id = ids[next++];
      if (id === undefined) return;
      out[id] = await Promise.race([lookup(id, namespace).catch(() => "unknown" as const), deadline]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(LIVENESS_CONCURRENCY, ids.length) }, worker));
  clearTimeout(timer);
  return out;
}
