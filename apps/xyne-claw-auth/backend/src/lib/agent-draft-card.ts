import { agentRepository, chatMessageRepository } from "../repositories/index.js";
import { postAgentMessage } from "../surfaces/spaces/post-message.js";
import { errMsg } from "./errors.js";
import { postFlowCard } from "./flow-card-delivery.js";
import { agentDraftTranscript, prepareAgentDraftCard, resolveDraftCapabilities } from "./agent-card-render.js";
import { isValidAgentSlug, type DraftAgentSpec } from "./agent-card.js";

/**
 * Where the draft card is posted and who it belongs to. Every caller already
 * holds these on its session context; naming them here keeps the entry point
 * independent of which route resolved the session.
 */
export interface AgentDraftCardContext {
  agentSlug: string;
  agentOrgId: string;
  requesterId: string;
  channelId: string;
  conversationId: string;
  spacesAppUserId: string;
  spacesAppId?: string | undefined;
  appToken: string;
}

export type AgentDraftCardOutcome =
  | { status: "posted"; requestId: string; slug: string }
  | { status: "rejected"; reason: "invalid_slug" | "duplicate_slug" }
  | { status: "failed" };

interface DraftCardLogger {
  info: (message: string, meta?: Record<string, unknown>) => void;
  warn: (message: string, meta?: Record<string, unknown>) => void;
  error: (message: string, meta?: Record<string, unknown>) => void;
}

/**
 * Spaces delivery of the agent draft card. Validation, the duplicate check,
 * capability resolution, AgentRequest persistence and the card itself come
 * from `prepareAgentDraftCard`, shared with the Xyne AI surfaces; this posts
 * the outcome into the Spaces thread and writes the transcript row.
 *
 * Callers own session teardown: this returns the outcome rather than ending
 * the run, because "rejected" and "posted" are both terminal for the draft
 * but not necessarily for the caller.
 */
export async function postAgentDraftCard(args: {
  spec: DraftAgentSpec;
  ctx: AgentDraftCardContext;
  /** Owner of the transcript row — the run's owner, not always the requester. */
  runOwnerId: string;
  reasoning?: string | undefined;
  log: DraftCardLogger;
}): Promise<AgentDraftCardOutcome> {
  const { spec, ctx, runOwnerId, log } = args;
  const { agentOrgId: orgId, requesterId, appToken: token } = ctx;

  const postPlain = async (markdownText: string): Promise<void> => {
    await postAgentMessage(
      { spacesAppUserId: ctx.spacesAppUserId, appToken: token },
      {
        channelId: ctx.channelId,
        conversationId: ctx.conversationId,
        markdownText,
        metadata: { contentFormat: "markdown" },
      },
    );
  };

  try {
    const prepared = await prepareAgentDraftCard(spec, {
      agentSlug: ctx.agentSlug,
      orgId,
      userId: requesterId,
      conversationId: ctx.conversationId,
      channelId: ctx.channelId,
      spacesAppId: ctx.spacesAppId,
    });
    if (!prepared.ok) {
      await postPlain(prepared.message);
      return { status: "rejected", reason: prepared.reason === "duplicate" ? "duplicate_slug" : "invalid_slug" };
    }
    const { flow, identity } = prepared;

    // A lead-in line so the card isn't dropped into the thread wordlessly.
    try {
      await postPlain(prepared.leadIn);
    } catch (e) {
      // Non-fatal: the card is the deliverable and still posts below.
      log.warn("Failed to post agent-draft lead-in (non-fatal)", { error: errMsg(e) });
    }

    await postFlowCard(flow, {
      kind: "spaces",
      channelId: ctx.channelId,
      conversationId: ctx.conversationId,
      spacesAppUserId: ctx.spacesAppUserId,
      appToken: token,
    });
    log.info(`[agent-card] posted draft card slug=${spec.slug} request=${prepared.requestId} conv=${ctx.conversationId}`);

    // Persist an assistant transcript row: the interactive card exists only in
    // Spaces, so without this the claw chat shows nothing for this turn and the
    // next user message groups as a sibling branch.
    try {
      const parentId = await chatMessageRepository
        .latestMessageId(ctx.conversationId, ctx.agentSlug)
        .catch(() => null);
      await chatMessageRepository.create({
        conversationId: ctx.conversationId,
        agentSlug: ctx.agentSlug,
        userId: runOwnerId,
        orgId,
        ...(parentId ? { parentId } : {}),
        role: "assistant",
        content: agentDraftTranscript(identity),
        status: "completed",
        ...(args.reasoning ? { reasoning: args.reasoning } : {}),
      });
    } catch (e) {
      log.warn("Failed to persist agent-draft assistant transcript row (non-fatal)", { error: errMsg(e) });
    }

    return { status: "posted", requestId: prepared.requestId, slug: spec.slug };
  } catch (err) {
    log.error("Failed to post agent draft card", { error: errMsg(err), slug: spec.slug });
    try {
      await postPlain("I drafted the agent but couldn't post it for approval. Please try again.");
    } catch {
      // The user already lost this turn; don't compound it with a throw.
    }
    return { status: "failed" };
  }
}

/**
 * `create-agent` params -> the draft spec the agent card is built from. The
 * tool's schema mirrors the spec field for field; anything the model sent that
 * is not a string list is dropped rather than trusted.
 */
export function draftSpecFromCreateAgentParams(params: Record<string, unknown>): DraftAgentSpec | null {
  const str = (key: string): string | undefined => {
    const value = params[key];
    return typeof value === "string" && value.trim() ? value.trim() : undefined;
  };
  const list = (key: string): string[] | undefined => {
    const value = params[key];
    if (!Array.isArray(value)) return undefined;
    const items = value.filter((v): v is string => typeof v === "string" && v.trim().length > 0);
    return items.length > 0 ? items : undefined;
  };

  const name = str("name");
  const systemPrompt = str("systemPrompt");
  if (!name || !systemPrompt) return null;

  const slug = str("slug") ?? name.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  if (!slug) return null;

  const knowledge =
    params["knowledge"] && typeof params["knowledge"] === "object"
      ? (params["knowledge"] as NonNullable<DraftAgentSpec["knowledge"]>)
      : null;
  const memory =
    params["memory"] && typeof params["memory"] === "object"
      ? (params["memory"] as NonNullable<DraftAgentSpec["memory"]>)
      : null;
  const scope = str("scope");

  return {
    name,
    slug,
    description: str("description") ?? "",
    systemPrompt,
    tools: list("tools") ?? [],
    ...(str("modelId") ? { modelId: str("modelId") as string } : {}),
    ...(str("color") ? { color: str("color") as string } : {}),
    ...(list("mcps") ? { mcps: list("mcps") as string[] } : {}),
    ...(list("skills") ? { skills: list("skills") as string[] } : {}),
    ...(list("providerOrder") ? { providerOrder: list("providerOrder") as string[] } : {}),
    ...(knowledge ? { knowledge } : {}),
    ...(memory ? { memory } : {}),
    ...(scope === "personal" || scope === "global" ? { scope } : {}),
    ...(str("summary") ? { summary: str("summary") as string } : {}),
  };
}

export async function createAgentQueueError(
  params: Record<string, unknown>,
  orgId: string,
): Promise<string | null> {
  const spec = draftSpecFromCreateAgentParams(params);
  if (!spec) return null;
  if (!isValidAgentSlug(spec.slug)) {
    return `\`${spec.slug}\` isn't a usable agent identifier — ask again with a simple name like "ticket triage".`;
  }
  const existing = await agentRepository.findBySlug(spec.slug, orgId);
  return existing
    ? `An agent called **${existing.name}** (\`${spec.slug}\`) already exists here — ask again with a different name, or update the existing agent.`
    : null;
}

export async function createAgentNotGranted(
  params: Record<string, unknown>,
  orgId: string,
  userId: string,
): Promise<string[]> {
  const spec = draftSpecFromCreateAgentParams(params);
  if (!spec) return [];
  const { resolved, expandedMcps } = await resolveDraftCapabilities(spec, orgId, userId);
  return [...resolved.unknown, ...expandedMcps.unknown];
}

const DRAFT_CARD_REPLY_MAX_CHARS = 500;

export function draftCardCarriesReply(args: {
  completed: boolean;
  conversation: boolean;
  actions: ReadonlyArray<{ rendersDraftCard: boolean; rejected: boolean }>;
  hasAttachments: boolean;
  hasPendingResponses: boolean;
  replyText: string;
}): boolean {
  return (
    args.completed &&
    args.conversation &&
    args.actions.length > 0 &&
    args.actions.every((a) => a.rendersDraftCard && !a.rejected) &&
    !args.hasAttachments &&
    !args.hasPendingResponses &&
    args.replyText.trim().length <= DRAFT_CARD_REPLY_MAX_CHARS
  );
}
