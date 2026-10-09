import { buildAgentCardFlow, hashSkillContent, withSpacesAppId } from "xyne-claw-shared";
import { agentRepository, chatMessageRepository } from "../repositories/index.js";
import { agentRequestRepository } from "../repositories/agentRequestRepository.js";
import { buildAvailableToolsCatalog } from "../routes/tools.js";
import { postAgentMessage } from "../surfaces/spaces/post-message.js";
import { errMsg } from "./errors.js";
import { postFlowCard } from "./flow-card-delivery.js";
import {
  identityFromDraftSpec,
  isValidAgentSlug,
  resolveAgentCapabilities,
  unknownToolsNote,
  draftNote,
  expandMcpRequests,
  listCallableAgentOptions,
  toConfigTools,
  unknownMcpsNote,
  unknownProvidersNote,
  resolveDraftExtras,
  type DraftAgentSpec,
} from "./agent-card.js";

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
 * Turn a drafted agent spec into the pending draft card: validate the slug,
 * refuse a duplicate, resolve the requested tools against the org catalog,
 * supersede this proposer's older drafts for the same slug, persist the
 * `agent_create` request, and post the card.
 *
 * The draft lives server-side — `proposedContent` is what the approve path
 * re-reads and creates, so the card is display only and cannot be edited into
 * something other than what was reviewed.
 *
 * Shared by every surface that can produce a draft. Callers own session
 * teardown: this returns the outcome rather than ending the run, because
 * "rejected" and "posted" are both terminal for the draft but not necessarily
 * for the caller.
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
    // Fail loudly on the card rather than silently creating a mis-slugged
    // agent: the pod normalizes, so an invalid slug here means drift.
    if (!isValidAgentSlug(spec.slug)) {
      await postPlain(
        `I drafted an agent but \`${spec.slug}\` isn't a usable identifier. Ask me again with a simple name like "ticket triage".`,
      );
      log.warn(`[agent-card] rejected draft with invalid slug "${spec.slug}" conv=${ctx.conversationId}`);
      return { status: "rejected", reason: "invalid_slug" };
    }

    // Duplicate slug: catch it NOW, while the agent can still be re-asked,
    // instead of at approval time when the user has already committed.
    const existing = await agentRepository.findBySlug(spec.slug, orgId);
    if (existing) {
      await postPlain(
        `An agent called **${existing.name}** (\`${spec.slug}\`) already exists here, so I didn't create a draft. Ask me again with a different name, or edit the existing agent.`,
      );
      log.info(`[agent-card] draft dropped — slug ${spec.slug} already exists in org ${orgId}`);
      return { status: "rejected", reason: "duplicate_slug" };
    }

    // Resolve the requested tools against THIS org's catalog. Unmatched
    // tokens are reported on the card and never persisted.
    const catalog = await buildAvailableToolsCatalog(undefined, orgId);
    const callableOptions = await listCallableAgentOptions(orgId, requesterId, spec.slug);
    const expandedMcps = expandMcpRequests(spec.mcps, catalog);
    if (expandedMcps.unknown.length > 0) {
      log.info(`[agent-card] draft ${spec.slug}: unmatched MCPs [${expandedMcps.unknown.join(", ")}]`);
    }
    const resolved = await resolveAgentCapabilities(
      [...(spec.tools ?? []), ...expandedMcps.tokens],
      catalog,
      requesterId,
      callableOptions,
    );
    const note = unknownToolsNote(resolved.unknown);
    if (resolved.unknown.length > 0) {
      log.info(`[agent-card] draft ${spec.slug}: unmatched tools [${resolved.unknown.join(", ")}]`);
    }

    const proposedContent = JSON.stringify(spec);
    const outcome = await agentRequestRepository.supersedeAndCreateAgentCreate({
      agentSlug: spec.slug,
      requesterId,
      orgId,
      proposedContent,
      proposedContentHash: hashSkillContent(proposedContent),
    });
    if (outcome.supersededCount > 0) {
      log.info(`[agent-card] superseded ${outcome.supersededCount} stale draft(s) for ${spec.slug} by ${requesterId}`);
    }

    // A lead-in line so the card isn't dropped into the thread wordlessly. The
    // agent's own `summary` (why it made these calls) when it wrote one;
    // otherwise a neutral line — never a restatement of the card, which would
    // just be the same content twice.
    const leadIn =
      spec.summary?.trim() ||
      `I've drafted an agent for this — have a look and approve it below if it's right.`;
    try {
      await postPlain(leadIn);
    } catch (e) {
      // Non-fatal: the card is the deliverable and still posts below.
      log.warn("Failed to post agent-draft lead-in (non-fatal)", { error: errMsg(e) });
    }

    const draftExtras = await resolveDraftExtras(spec, orgId, requesterId);
    const cardNote = draftNote(
      note,
      unknownMcpsNote(expandedMcps.unknown),
      unknownProvidersNote(draftExtras.unknownProviders ?? []),
    );
    const identity = identityFromDraftSpec(spec, resolved, ctx.agentSlug, draftExtras);
    const flow = withSpacesAppId(
      buildAgentCardFlow(
        {
          variant: "draft",
          phase: "pending",
          agent: identity,
          toolSelection: toConfigTools(resolved),
          ...(cardNote ? { note: cardNote } : {}),
        },
        {
          requestId: outcome.request.id,
          agentSlug: ctx.agentSlug,
          userId: requesterId,
          conversationId: ctx.conversationId,
          channelId: ctx.channelId,
        },
      ),
      ctx.spacesAppId,
    );

    await postFlowCard(flow, {
      kind: "spaces",
      channelId: ctx.channelId,
      conversationId: ctx.conversationId,
      spacesAppUserId: ctx.spacesAppUserId,
      appToken: token,
    });
    log.info(`[agent-card] posted draft card slug=${spec.slug} request=${outcome.request.id} conv=${ctx.conversationId}`);

    // Persist an assistant transcript row: the interactive card exists only in
    // Spaces, so without this the claw chat shows nothing for this turn and the
    // next user message groups as a sibling branch.
    try {
      const capabilityLine = identity.capabilities?.length
        ? `\n\n**Capabilities:** ${identity.capabilities.map((c) => c.label).join(", ")}`
        : "";
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
        content: `**🤖 Drafted an agent — ${identity.name}** (\`${identity.slug}\`)\n\n${identity.description ?? ""}${capabilityLine}\n\n_Approve the card to create it._`,
        status: "completed",
        ...(args.reasoning ? { reasoning: args.reasoning } : {}),
      });
    } catch (e) {
      log.warn("Failed to persist agent-draft assistant transcript row (non-fatal)", { error: errMsg(e) });
    }

    return { status: "posted", requestId: outcome.request.id, slug: spec.slug };
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
