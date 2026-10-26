import type { Prisma } from "@prisma/client";
import { SDLC_TOOL_NAMES } from "xyne-claw-shared";
import { CONFIG } from "../config.js";
import { prisma } from "../db.js";
import { createLogger } from "../logger.js";
import { errMsg } from "./errors.js";
import { getSpacesAuthForUser } from "./spaces-db.js";
import { spacesUserIdForClawUser } from "./users-jit.js";
import { spacesFetch } from "../mcp/servers/xyne-spaces-client.js";

const log = createLogger("sdlc-repository-context");

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
  workspaceId?: string,
): Promise<SdlcRepositoryResolution> {
  if (researchContext?.type !== "repository" || typeof researchContext.id !== "string" || !researchContext.id.trim()) {
    return { ok: true };
  }

  const auth = await getSpacesAuthForUser(userId, "agent-chat", workspaceId);
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
  workspaceId?: string,
): Promise<Record<string, unknown> | undefined> {
  if (!channelId || !conversationId) return undefined;
  const auth = await getSpacesAuthForUser(userId, "agent-chat", workspaceId);
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

function s2sAuth(): { s2sKey: string; baseUrl: string } | undefined {
  const s2sKey = process.env["INTERNAL_S2S_KEY"] ?? process.env["XYNE_CLAW_S2S_KEY"] ?? "";
  return s2sKey ? { s2sKey, baseUrl: CONFIG.spacesInternalUrl } : undefined;
}

export interface SdlcHubKnowledge {
  /** Pinned Knowledge Files, in full. */
  documents: Array<{ title: string; markdown: string }>;
  files: Array<{ canvasId: string; title: string }>;
  skills: Array<{ skillId: string; pinned: boolean }>;
}

export async function loadSdlcHubKnowledge(channelId: string, userId: string): Promise<SdlcHubKnowledge | undefined> {
  const auth = s2sAuth();
  if (!auth) return undefined;
  const response = (await spacesFetch(
    "/api/internal/sdlc/agent/hub-knowledge",
    // Runs at every SDLC run start, which the 30 s default would stall.
    { method: "POST", body: JSON.stringify({ channelId, actorUserId: userId }), signal: AbortSignal.timeout(5_000) },
    auth,
  )) as Partial<SdlcHubKnowledge>;
  return { documents: response.documents ?? [], files: response.files ?? [], skills: response.skills ?? [] };
}

// Every listed file is a prompt line in every hub run.
const HUB_FILE_LIST_CAP = 50;

/** Pinned items in full, then the other Knowledge Files by name. Unpinned skills travel as skills, not here. */
export function renderSdlcHubKnowledge(
  knowledge: SdlcHubKnowledge,
  pinnedSkills: Array<{ name: string; content: string }>,
): string | undefined {
  const pinned = [
    ...knowledge.documents.map((document) => `## ${document.title}\n\n${document.markdown}`),
    ...pinnedSkills.map((skill) => `## Skill: ${skill.name}\n\n${skill.content}`),
  ];
  if (pinned.length === 0 && knowledge.files.length === 0) return undefined;
  return [
    "# Hub Knowledge",
    "Knowledge for this SDLC hub. It can lag the code, so check the code before relying on a detail.",
    ...pinned,
    ...(knowledge.files.length > 0
      ? [
          `## Knowledge Files\n\nNot loaded. Read one with ${SDLC_TOOL_NAMES.readArtifact} and its canvasId when the request touches its subject.\n\n` +
            knowledge.files.slice(0, HUB_FILE_LIST_CAP).map((file) => `- ${file.title} (canvasId ${file.canvasId})`).join("\n") +
            (knowledge.files.length > HUB_FILE_LIST_CAP
              ? `\n\n${knowledge.files.length - HUB_FILE_LIST_CAP} more are not listed. Find them with ${SDLC_TOOL_NAMES.listArtifacts}.`
              : ""),
        ]
      : []),
  ].join("\n\n");
}

type HubRunSkill = Prisma.SkillGetPayload<{ include: { files: true } }>;

/** Which Linked Skills one user's run may load: a global one reaches every member, a personal one only its owner. */
export function hubRunSkillWhere(skillIds: string[], userId: string, orgId: string): Prisma.SkillWhereInput {
  return { id: { in: skillIds }, orgId, enabled: true, OR: [{ scope: "global" }, { ownerUserId: userId }] };
}

/** What a hub adds to one user's run: the Hub Knowledge text and the Linked Skills they may load. */
export async function loadHubRunContext(
  channelId: string,
  // Hub membership is keyed by the Spaces user id, skill ownership by the Claw one.
  spacesUserId: string,
  userId: string,
  orgId: string,
): Promise<{ text?: string; skills: HubRunSkill[] }> {
  const hub = await loadSdlcHubKnowledge(channelId, spacesUserId);
  if (!hub) return { skills: [] };
  // Every channel run reaches here, and only a hub has links.
  const skills =
    hub.skills.length === 0
      ? []
      : await prisma.skill
          .findMany({
            where: hubRunSkillWhere(hub.skills.map((skill) => skill.skillId), userId, orgId),
            include: { files: true },
          })
          // The Knowledge Files still reach the run when the skill lookup fails.
          .catch((err: unknown) => {
            log.warn(`[sdlc] failed to load Linked Skills for hub ${channelId}: ${errMsg(err)}`);
            return [] as HubRunSkill[];
          });
  const pinnedIds = new Set(hub.skills.filter((skill) => skill.pinned).map((skill) => skill.skillId));
  const text = renderSdlcHubKnowledge(hub, skills.filter((skill) => pinnedIds.has(skill.id)));
  // Pinned skills stay in `skills` too: the text carries their body, the skill entry their files.
  return { ...(text ? { text } : {}), skills };
}

/** Links a skill made during a hub run to that hub. Spaces ignores a channel that is not a hub. */
export async function linkSdlcHubSkill(channelId: string, userId: string, skillId: string): Promise<void> {
  const auth = s2sAuth();
  if (!auth) return;
  // Spaces checks hub membership by the Spaces user id. Callers pass it when they have it; a Claw id is converted.
  const actorUserId = await spacesUserIdForClawUser(userId);
  await spacesFetch(
    "/api/internal/sdlc/agent/hub-skill",
    { method: "POST", body: JSON.stringify({ channelId, actorUserId, skillId }), signal: AbortSignal.timeout(5_000) },
    auth,
  );
}

/** Tells Spaces an agent got its bot user, so an SDLC hub it was created in adds it right away. */
export async function notifySdlcAgentRegistered(agentId: string, botUserId: string): Promise<void> {
  const auth = s2sAuth();
  if (!auth) return;
  await spacesFetch(
    "/api/internal/sdlc/agent/registered",
    { method: "POST", body: JSON.stringify({ agentId, botUserId }), signal: AbortSignal.timeout(5_000) },
    auth,
  );
}
