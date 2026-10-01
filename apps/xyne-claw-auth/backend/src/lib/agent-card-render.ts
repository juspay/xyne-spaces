import { buildAgentCardFlow, buildAgentSummaryFlow, MAX_AGENT_LIST_CARDS, withSpacesAppId, type FlowDefinition } from "xyne-claw-shared";
import { prisma } from "../db.js";
import { createLogger } from "../logger.js";
import { agentRepository } from "../repositories/index.js";
import { buildAvailableToolsCatalog } from "../routes/tools.js";
import {
  identityFromAgentRow,
  listCallableAgentOptions,
  resolveAgentCapabilities,
  toolIdsFromConfig,
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
