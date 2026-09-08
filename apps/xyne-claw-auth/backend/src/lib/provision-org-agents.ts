import type { Prisma } from "@prisma/client";
import { prisma } from "../db.js";
import { createLogger } from "../logger.js";

const log = createLogger("provision-org-agents");

const DEFAULT_AGENT_SLUGS = ["ask-ai", "xyne-spaces-architect"] as const;

/**
 * Idempotent: copies `ask-ai` and `xyne-spaces-architect` into `orgId` from
 * the oldest org that already has them. Safe to call multiple times — skips
 * slugs that already exist, and exits immediately when both are present.
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

  for (const slug of toProvision) {
    const source = await prisma.agent.findFirst({
      where: { slug, orgId: { not: orgId } },
      orderBy: { createdAt: "asc" },
      include: {
        skills: {
          include: { skill: true },
        },
        tools: true,
      },
    });

    if (!source) {
      log.warn(`[provision-org-agents] no source agent for slug=${slug} — skipping (no org has it yet)`);
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

    log.info(`[provision-org-agents] provisioned slug=${slug} orgId=${orgId} skills=${source.skills.length} tools=${source.tools.length}`);
  }
}
