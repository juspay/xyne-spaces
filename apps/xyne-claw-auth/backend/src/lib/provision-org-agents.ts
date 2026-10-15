import type { Prisma } from "@prisma/client";
import { prisma } from "../db.js";
import { CONFIG } from "../config.js";
import { createLogger } from "../logger.js";

const log = createLogger("provision-org-agents");

export const DEFAULT_AGENT_SLUGS: readonly string[] = CONFIG.defaultAgentSlugs;

/**
 * The ONE org every default agent is copied from. Whatever subset of
 * DEFAULT_AGENT_SLUGS that org has is what gets copied — no other org is consulted.
 *
 * 1. `DEFAULT_AGENTS_SOURCE_ORG_NAME` (Organization.name is unique), when set and found.
 * 2. Otherwise the oldest org (by Organization.createdAt, excluding the target)
 *    that has at least one of DEFAULT_AGENT_SLUGS.
 *
 * Returns null when there is nothing to copy from.
 */
export async function resolveDefaultAgentsSourceOrgId(targetOrgId: string): Promise<string | null> {
  const sourceName = CONFIG.defaultAgentsSourceOrgName;
  if (sourceName) {
    const named = await prisma.organization.findUnique({ where: { name: sourceName }, select: { id: true } });
    if (named) {
      if (named.id === targetOrgId) return null; // the source org itself — nothing to copy
      return named.id;
    }
    log.warn(`[provision-org-agents] DEFAULT_AGENTS_SOURCE_ORG_NAME="${sourceName}" not found — falling back to oldest org`);
  }

  const org = await prisma.organization.findFirst({
    where: {
      id: { not: targetOrgId },
      agents: { some: { slug: { in: [...DEFAULT_AGENT_SLUGS] } } },
    },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  return org?.id ?? null;
}

/**
 * Idempotent: copies DEFAULT_AGENT_SLUGS (env `DEFAULT_AGENT_SLUGS`) into
 * `orgId` from ONE source org (see resolveDefaultAgentsSourceOrgId). Safe to call
 * multiple times — skips slugs that already exist, and exits immediately when
 * all are present.
 *
 * Copies: agent row, skills (with content), AgentSkill links, AgentTool links.
 * Does NOT copy: AgentProviderCredentials, spacesAppId/Token, signingSecret,
 * ownerUserId — those are org/installation-specific.
 */
export async function provisionDefaultAgents(orgId: string): Promise<void> {
  const existing = await prisma.agent.findMany({
    where: { orgId, slug: { in: [...DEFAULT_AGENT_SLUGS] } },
    select: { slug: true },
  });

  const existingSlugs = new Set(existing.map((a) => a.slug));
  const toProvision = DEFAULT_AGENT_SLUGS.filter((s) => !existingSlugs.has(s));
  if (toProvision.length === 0) return;

  const sourceOrgId = await resolveDefaultAgentsSourceOrgId(orgId);
  if (!sourceOrgId) {
    log.warn(`[provision-org-agents] no source org has default agents — skipping orgId=${orgId}`);
    return;
  }

  const sources = await prisma.agent.findMany({
    where: { orgId: sourceOrgId, slug: { in: toProvision } },
    include: {
      skills: {
        include: { skill: true },
      },
      tools: true,
    },
  });
  const sourceBySlug = new Map(sources.map((a) => [a.slug, a]));

  for (const slug of toProvision) {
    const source = sourceBySlug.get(slug);
    if (!source) {
      log.warn(`[provision-org-agents] source org ${sourceOrgId} has no agent slug=${slug} — skipping`);
      continue;
    }

    const newAgent = await prisma.agent.upsert({
      where: { orgId_slug: { orgId, slug } },
      create: {
        slug,
        orgId,
        name: source.name,
        description: source.description,
        systemPrompt: source.systemPrompt,
        scope: source.scope,
        color: source.color,
        config: (source.config ?? {}) as Prisma.InputJsonValue,
        delegationTier: source.delegationTier,
        kbScope: source.kbScope,
        enabled: source.enabled,
      },
      update: {},
    });

    for (const agentSkill of source.skills) {
      const sk = agentSkill.skill;
      const newSkill = await prisma.skill.upsert({
        where: { orgId_slug: { orgId, slug: sk.slug } },
        create: {
          slug: sk.slug,
          orgId,
          name: sk.name,
          description: sk.description,
          content: sk.content,
          source: sk.source,
          scope: sk.scope,
          enabled: sk.enabled,
        },
        update: {},
      });
      await prisma.agentSkill.upsert({
        where: { agentId_skillId: { agentId: newAgent.id, skillId: newSkill.id } },
        create: { agentId: newAgent.id, skillId: newSkill.id },
        update: {},
      });
    }

    for (const at of source.tools) {
      await prisma.agentTool.upsert({
        where: { agentId_toolId: { agentId: newAgent.id, toolId: at.toolId } },
        create: { agentId: newAgent.id, toolId: at.toolId, permission: at.permission },
        update: { permission: at.permission },
      });
    }

    log.info(`[provision-org-agents] provisioned slug=${slug} orgId=${orgId} sourceOrgId=${sourceOrgId} skills=${source.skills.length} tools=${source.tools.length}`);
  }
}
