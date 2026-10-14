import { isLocalHarnessProvider, type LocalHarnessProvider } from "xyne-claw-shared";

export const LOCAL_HARNESS_OVERRIDE_PREFIX = "local-harness:";

export type LocalHarnessOverride =
  | { pinned: false }
  | { pinned: true; provider: LocalHarnessProvider }
  | { pinned: true; error: string };

/**
 * Reads a `providerOverride` that asks to run on the user's own machine:
 * `{ provider: "local-harness", model: "local-harness:claude-code" | "local-harness:codex-cli" }`.
 *
 * Anything else under `provider: "local-harness"` (no model, `local-harness:` with
 * nothing after it, an unknown CLI) is an error. It used to resolve to an empty
 * provider and quietly fall back to the gated resolver, so the run went to the
 * server while the user believed they had picked their machine.
 */
export function parseLocalHarnessOverride(
  override: { provider?: unknown; model?: unknown } | null | undefined,
): LocalHarnessOverride {
  if (!override || override.provider !== "local-harness") return { pinned: false };
  const model = typeof override.model === "string" ? override.model.trim() : "";
  const provider = model.startsWith(LOCAL_HARNESS_OVERRIDE_PREFIX)
    ? model.slice(LOCAL_HARNESS_OVERRIDE_PREFIX.length)
    : "";
  if (isLocalHarnessProvider(provider)) return { pinned: true, provider };
  return {
    pinned: true,
    error:
      `Unknown local harness provider "${model}". ` +
      `Use "${LOCAL_HARNESS_OVERRIDE_PREFIX}claude-code" or "${LOCAL_HARNESS_OVERRIDE_PREFIX}codex-cli".`,
  };
}
