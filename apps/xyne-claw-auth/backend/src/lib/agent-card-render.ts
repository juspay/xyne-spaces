import { buildAgentCardFlow, buildAgentSummaryFlow, hashSkillContent, MAX_AGENT_LIST_CARDS, withSpacesAppId, type AgentIdentity, type FlowDefinition } from "xyne-claw-shared";
import { prisma } from "../db.js";
import { createLogger } from "../logger.js";
import { agentRepository } from "../repositories/index.js";
import { agentRequestRepository } from "../repositories/agentRequestRepository.js";
import { buildAvailableToolsCatalog } from "../routes/tools.js";
import {
  draftNote,
  expandMcpRequests,
  identityFromAgentRow,
  identityFromDraftSpec,
  isValidAgentSlug,
  listCallableAgentOptions,
  resolveAgentCapabilities,
  resolveDraftExtras,
  toConfigTools,
  toolIdsFromConfig,
  unknownMcpsNote,
  unknownProvidersNote,
  unknownToolsNote,
  type DraftAgentSpec,
} from "./agent-card.js";
import { postFlowCard, type FlowCardTarget } from "./flow-card-delivery.js";

const log = createLogger("agent-card");

const AGENT_SUMMARY_SAMPLE = 5;

async function agentOwnerCredit(
  ownerUserId: string | null | undefined,
): Promise<{ name?: string | null; id?: string | null } | undefined> {
  if (!ownerUserId) return undefined;
  const owner = await prisma.user
    .findUnique({ where: { id: ownerUserId }, select: { id: true, name: true } })
    .catch(() => null);
  return owner?.name ? { name: owner.name, id: owner.id } : undefined;
}

export interface AgentCardIdentity {
  agentSlug: string;
  orgId: string;
  userId: string;
  conversationId: string;
  channelId: string;
  spacesAppId: string | undefined;
}

export async function renderAgentProfileCard(
  targetSlug: string,
  id: AgentCardIdentity,
  target: FlowCardTarget,
): Promise<FlowDefinition | null> {
  const row = await agentRepository.findBySlug(targetSlug, id.orgId);
  if (!row) {
    log.info(`[agent-card] profile card skipped — no agent "${targetSlug}" in org ${id.orgId}`);
    return null;
  }
  const catalog = await buildAvailableToolsCatalog(undefined, id.orgId);
  const resolved = await resolveAgentCapabilities(
    toolIdsFromConfig(row.config),
    catalog,
    id.userId,
    await listCallableAgentOptions(id.orgId, id.userId, row.slug),
  );
  const ownerCredit = await agentOwnerCredit(row.ownerUserId);
  const flow = withSpacesAppId(
    buildAgentCardFlow(
      { variant: "profile", agent: identityFromAgentRow(row, resolved, undefined, ownerCredit) },
      {
        agentSlug: id.agentSlug,
        targetSlug,
        userId: id.userId,
        conversationId: id.conversationId,
        channelId: id.channelId,
      },
    ),
    id.spacesAppId,
  );
  const posted = await postFlowCard(flow, target);
  log.info(`[agent-card] posted profile card for ${targetSlug} conv=${id.conversationId}`);
  return posted;
}

export async function renderAgentSummaryCard(
  id: AgentCardIdentity,
  target: FlowCardTarget,
): Promise<FlowDefinition | null> {
  const [total, globalCount, sampleAgents] = await Promise.all([
    prisma.agent.count({ where: { orgId: id.orgId, enabled: true } }),
    prisma.agent.count({ where: { orgId: id.orgId, enabled: true, scope: "global" } }),
    prisma.agent.findMany({
      where: { orgId: id.orgId, enabled: true },
      select: { slug: true, name: true, description: true },
      orderBy: { name: "asc" },
      take: AGENT_SUMMARY_SAMPLE,
    }),
  ]);

  if (total === 0) {
    log.info(`[agent-card] summary skipped — no agents in org ${id.orgId}`);
    return null;
  }
  const flow = withSpacesAppId(
    buildAgentSummaryFlow(
      {
        total,
        global: globalCount,
        personal: total - globalCount,
        agents: sampleAgents.map((a) => ({
          slug: a.slug,
          name: a.name,
          ...(a.description ? { description: a.description } : {}),
        })),
      },
      {
        agentSlug: id.agentSlug,
        userId: id.userId,
        conversationId: id.conversationId,
        channelId: id.channelId,
      },
    ),
    id.spacesAppId,
  );
  const posted = await postFlowCard(flow, target);
  log.info(`[agent-card] posted roster summary (${total}) conv=${id.conversationId}`);
  return posted;
}

export async function renderAgentProfileListCard(
  slugs: string[],
  id: AgentCardIdentity,
  target: FlowCardTarget,
): Promise<FlowDefinition | null> {
  const unique = [...new Set(slugs.map((slug) => slug.trim()).filter((slug) => slug.length > 0))];
  const capped = unique.slice(0, MAX_AGENT_LIST_CARDS);

  const rows = [];
  for (const slug of capped) {
    const row = await agentRepository.findBySlug(slug, id.orgId);
    if (!row) {
      log.info(`[agent-card] list row skipped — no agent "${slug}" in org ${id.orgId}`);
      continue;
    }
    rows.push({
      slug: row.slug,
      name: row.name,
      ...(row.description ? { description: row.description } : {}),
    });
  }

  if (rows.length === 0) {
    log.info(`[agent-card] list card skipped — none of ${unique.length} slugs resolved`);
    return null;
  }
  const flow = withSpacesAppId(
    buildAgentSummaryFlow(
      { total: rows.length, agents: rows },
      {
        agentSlug: id.agentSlug,
        userId: id.userId,
        conversationId: id.conversationId,
        channelId: id.channelId,
      },
      `${rows.length} ${rows.length === 1 ? "agent" : "agents"} that can help`,
    ),
    id.spacesAppId,
  );
  const posted = await postFlowCard(flow, target);
  log.info(`[agent-card] posted ${rows.length} matching agents conv=${id.conversationId}`);
  return posted;
}

export type AgentDraftCardResult =
  | { ok: false; reason: "invalid-slug" | "duplicate"; message: string }
  | { ok: true; flow: FlowDefinition; identity: AgentIdentity; requestId: string; leadIn: string };

/** The neutral lead-in used when the drafting agent wrote no `summary`. */
export const DEFAULT_AGENT_DRAFT_LEAD_IN =
  "I've drafted an agent for this — have a look and approve it below if it's right.";

/** Lead-in shown above a draft card: the agent's own summary when present. */
export function agentDraftLeadIn(spec: Pick<DraftAgentSpec, "summary">): string {
  return spec.summary?.trim() || DEFAULT_AGENT_DRAFT_LEAD_IN;
}

/**
 * Surface-neutral half of the propose-agent draft card: validates the slug,
 * rejects duplicates while the agent can still be re-asked, resolves the
 * requested capabilities against THIS org's catalog, persists the draft as an
 * AgentRequest (superseding stale drafts — the approve path re-reads
 * `proposedContent`, so the card is display only) and builds the pending card.
 *
 * Delivery stays with the caller (Spaces thread vs Xyne AI row), so both
 * surfaces share one validation + persistence path and cannot drift.
 */
export async function prepareAgentDraftCard(
  spec: DraftAgentSpec,
  id: AgentCardIdentity,
): Promise<AgentDraftCardResult> {
  if (!isValidAgentSlug(spec.slug)) {
    log.warn(`[agent-card] rejected draft with invalid slug "${spec.slug}" conv=${id.conversationId}`);
    return {
      ok: false,
      reason: "invalid-slug",
      message: `I drafted an agent but \`${spec.slug}\` isn't a usable identifier. Ask me again with a simple name like "ticket triage".`,
    };
  }

  const existing = await agentRepository.findBySlug(spec.slug, id.orgId);
  if (existing) {
    log.info(`[agent-card] draft dropped — slug ${spec.slug} already exists in org ${id.orgId}`);
    return {
      ok: false,
      reason: "duplicate",
      message: `An agent called **${existing.name}** (\`${spec.slug}\`) already exists here, so I didn't create a draft. Ask me again with a different name, or edit the existing agent.`,
    };
  }

  const catalog = await buildAvailableToolsCatalog(undefined, id.orgId);
  const callableOptions = await listCallableAgentOptions(id.orgId, id.userId, spec.slug);
  const expandedMcps = expandMcpRequests(spec.mcps, catalog);
  if (expandedMcps.unknown.length > 0) {
    log.info(`[agent-card] draft ${spec.slug}: unmatched MCPs [${expandedMcps.unknown.join(", ")}]`);
  }
  const resolved = await resolveAgentCapabilities(
    [...(spec.tools ?? []), ...expandedMcps.tokens],
    catalog,
    id.userId,
    callableOptions,
  );
  if (resolved.unknown.length > 0) {
    log.info(`[agent-card] draft ${spec.slug}: unmatched tools [${resolved.unknown.join(", ")}]`);
  }

  const proposedContent = JSON.stringify(spec);
  const outcome = await agentRequestRepository.supersedeAndCreateAgentCreate({
    agentSlug: spec.slug,
    requesterId: id.userId,
    orgId: id.orgId,
    proposedContent,
    proposedContentHash: hashSkillContent(proposedContent),
  });
  if (outcome.supersededCount > 0) {
    log.info(`[agent-card] superseded ${outcome.supersededCount} stale draft(s) for ${spec.slug} by ${id.userId}`);
  }

  const draftExtras = await resolveDraftExtras(spec, id.orgId, id.userId);
  const cardNote = draftNote(
    unknownToolsNote(resolved.unknown),
    unknownMcpsNote(expandedMcps.unknown),
    unknownProvidersNote(draftExtras.unknownProviders ?? []),
  );
  const identity = identityFromDraftSpec(spec, resolved, id.agentSlug, draftExtras);
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
        agentSlug: id.agentSlug,
        userId: id.userId,
        conversationId: id.conversationId,
        ...(id.channelId ? { channelId: id.channelId } : {}),
      },
    ),
    id.spacesAppId,
  );
  return { ok: true, flow, identity, requestId: outcome.request.id, leadIn: agentDraftLeadIn(spec) };
}

/** Markdown transcript line for a drafted agent — what the chat shows for the
 *  turn when the interactive card is not rendered (history, exports). */
export function agentDraftTranscript(identity: AgentIdentity): string {
  const capabilityLine = identity.capabilities?.length
    ? `\n\n**Capabilities:** ${identity.capabilities.map((c) => c.label).join(", ")}`
    : "";
  return `**🤖 Drafted an agent — ${identity.name}** (\`${identity.slug}\`)\n\n${identity.description ?? ""}${capabilityLine}\n\n_Approve the card to create it._`;
}
