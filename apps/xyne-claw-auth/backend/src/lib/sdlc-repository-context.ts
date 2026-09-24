import { CONFIG } from "../config.js";
import { errMsg } from "./errors.js";
import { getSpacesAuthForUser } from "./spaces-db.js";
import { spacesFetch } from "../mcp/servers/xyne-spaces-client.js";

export interface SdlcRepositoryContext {
  repoId: string;
  name: string;
  url: string;
  baseBranch: string;
  agentContext: Record<string, unknown>;
}

export interface ResearchRepositoryContext {
  type?: unknown;
  id?: unknown;
}

export type SdlcRepositoryResolution =
  | { ok: true; repository?: SdlcRepositoryContext }
  | { ok: false; status: number; error: string };

export async function resolveSdlcRepositoryForUser(
  userId: string,
  researchContext: ResearchRepositoryContext | null | undefined,
  conversationId: string,
): Promise<SdlcRepositoryResolution> {
  if (researchContext?.type !== "repository" || typeof researchContext.id !== "string" || !researchContext.id.trim()) {
    return { ok: true };
  }

  const auth = await getSpacesAuthForUser(userId, "agent-chat");
  if (!auth) {
    return { ok: false, status: 401, error: "Spaces credentials are required to resolve the SDLC repository" };
  }

  try {
    const response = await spacesFetch(
      `/api/sdlc/repositories/${encodeURIComponent(researchContext.id.trim())}/context?conversationId=${encodeURIComponent(conversationId)}`,
      undefined,
      { ...auth, baseUrl: CONFIG.spacesInternalUrl },
    ) as {
      success?: boolean;
      context?: {
        repoId?: string;
        name?: string;
        url?: string;
        baseBranch?: string;
        agentContext?: Record<string, unknown>;
      };
    };
    const context = response.context;
    if (
      !response.success ||
      !context?.repoId ||
      !context.name ||
      !context.url ||
      !context.baseBranch ||
      !context.agentContext
    ) {
      return { ok: false, status: 502, error: "Spaces returned an invalid SDLC repository context" };
    }
    return {
      ok: true,
      repository: {
        repoId: context.repoId,
        name: context.name,
        url: context.url,
        baseBranch: context.baseBranch,
        agentContext: context.agentContext,
      },
    };
  } catch (error) {
    const message = errMsg(error);
    const status = Number(message.match(/Spaces API (\d{3})/)?.[1] ?? 503);
    return {
      ok: false,
      status: status === 401 || status === 403 || status === 404 ? status : 503,
      error: status === 403
        ? "You are not a member of this SDLC Hub"
        : status === 404
          ? "SDLC repository not found"
          : "Unable to resolve the SDLC repository",
    };
  }
}

export async function resolveSdlcHubContextForUser(
  userId: string,
  channelId: string | undefined,
  conversationId: string | undefined,
): Promise<Record<string, unknown> | undefined> {
  if (!channelId || !conversationId) return undefined;
  const auth = await getSpacesAuthForUser(userId, "agent-chat");
  if (!auth) return undefined;
  try {
    const response = (await spacesFetch(
      `/api/sdlc/channels/${encodeURIComponent(channelId)}/context?conversationId=${encodeURIComponent(conversationId)}`,
      // Runs at the start of every channel run, which the 30 s default would stall.
      { signal: AbortSignal.timeout(5_000) },
      { ...auth, baseUrl: CONFIG.spacesInternalUrl },
    )) as { context?: Record<string, unknown> | null };
    return response.context ?? undefined;
  } catch {
    return undefined;
  }
}

export async function loadSdlcHubKnowledge(channelId: string, userId: string): Promise<string | undefined> {
  const s2sKey = process.env["INTERNAL_S2S_KEY"] ?? process.env["XYNE_CLAW_S2S_KEY"] ?? "";
  if (!s2sKey) return undefined;
  const response = (await spacesFetch(
    "/api/internal/sdlc/agent/hub-knowledge",
    // Runs at every SDLC run start, which the 30 s default would stall.
    { method: "POST", body: JSON.stringify({ channelId, actorUserId: userId }), signal: AbortSignal.timeout(5_000) },
    { s2sKey, baseUrl: CONFIG.spacesInternalUrl },
  )) as { documents?: Array<{ title: string; markdown: string }> };
  const documents = response.documents ?? [];
  if (documents.length === 0) return undefined;
  return [
    "# Hub Knowledge",
    "Standing context for this SDLC hub, generated from its repositories. It can lag the code, so check the code before relying on a detail.",
    ...documents.map((document) => `## ${document.title}\n\n${document.markdown}`),
  ].join("\n\n");
}
