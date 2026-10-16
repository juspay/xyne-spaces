import type { CustomObjectsApi } from "@kubernetes/client-node";
import { createKubeClient, DEFAULT_NAMESPACE, SANDBOXES_GROUP, SANDBOXES_PLURAL, VERSION } from "./client.js";

/**
 * - `alive`: the Sandbox object exists and is not being deleted.
 * - `ended`: it is gone (404) or being deleted. Sandbox names are not reused.
 * - `unknown`: any other failure. Callers must change nothing.
 */
export type SandboxLiveness = "alive" | "ended" | "unknown";

export interface SandboxLivenessOptions {
  namespace?: string;
  k8sClient?: CustomObjectsApi;
}

let sharedClient: CustomObjectsApi | undefined;

/** Look up one sandbox by name (Claw's `Session.id`). */
export async function getSandboxLiveness(sandboxId: string, options: SandboxLivenessOptions = {}): Promise<SandboxLiveness> {
  const client = options.k8sClient ?? (sharedClient ??= createKubeClient());
  try {
    const { body } = await client.getNamespacedCustomObject(
      SANDBOXES_GROUP,
      VERSION,
      options.namespace ?? DEFAULT_NAMESPACE,
      SANDBOXES_PLURAL,
      sandboxId,
    );
    return (body as { metadata?: { deletionTimestamp?: unknown } } | null)?.metadata?.deletionTimestamp ? "ended" : "alive";
  } catch (err) {
    const e = err as { statusCode?: number; response?: { statusCode?: number } } | null;
    return (e?.statusCode ?? e?.response?.statusCode) === 404 ? "ended" : "unknown";
  }
}
