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
