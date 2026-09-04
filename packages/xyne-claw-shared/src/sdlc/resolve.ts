import { SDLC_AGENT_SLUG } from "./registry.js";
import { packSdlcRunMeta, SDLC_META_KEYS } from "./meta.js";

export async function resolveSdlcRepositoryIntoMeta(
  meta: Record<string, string>,
  repoId: string,
): Promise<void> {
  const actorUserId = meta["userId"]?.trim();
  const conversationId = meta["conversationId"]?.trim();
  if (!actorUserId) throw new Error("SDLC repository selection requires an acting user");
  if (!conversationId) {
    throw new Error("SDLC repository selection is only available on conversation runs");
  }

  const baseUrl = (process.env["SPACES_BACKEND_URL"] ?? process.env["XYNE_SPACES_URL"] ?? "")
    .replace(/\/+$/, "");
  const s2sKey = process.env["XYNE_CLAW_S2S_KEY"] ?? "";
  if (!baseUrl || !s2sKey) {
    throw new Error("Spaces URL or S2S key is unavailable for SDLC repository selection");
  }

  const response = await fetch(`${baseUrl}/api/internal/sdlc/agent/repository-context`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-s2s-key": s2sKey },
    body: JSON.stringify({
      agentSlug: SDLC_AGENT_SLUG,
      repoId,
      actorUserId,
      conversationId,
      ...(meta["channelId"]?.trim() ? { channelId: meta["channelId"].trim() } : {}),
    }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) {
    throw new Error(`SDLC repository is unavailable (HTTP ${response.status})`);
  }

  const payload = (await response.json()) as {
    context?: { agentContext?: unknown };
  };
  const resolved = packSdlcRunMeta(payload.context?.agentContext);
  if (!resolved[SDLC_META_KEYS.repositoryId]) {
    throw new Error("Spaces returned an invalid SDLC repository context");
  }
  Object.assign(meta, resolved);
}
