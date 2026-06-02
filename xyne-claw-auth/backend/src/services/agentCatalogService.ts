import { prisma } from "../db.js";
import { parseToolsConfig } from "xyne-claw-shared";

const CLAW_SLUG = "claw";

/**
 * Build a live markdown catalog of all agents visible to the given user.
 * Excludes the Claw concierge itself, disabled agents, and agents the user
 * cannot see (respects global / owned / shared visibility rules).
 *
 * This is injected into additionalInstructions on every /run call for the
 * Claw agent so the LLM always sees the current agent list without any
 * hardcoded names.
 */
export async function buildAgentCatalog(userId: string): Promise<string> {
  const agents = await prisma.agent.findMany({
    where: {
      enabled: true,
      slug: { not: CLAW_SLUG },
      OR: [
        { scope: "global" },
        { ownerUserId: userId },
        { shares: { some: { userId } } },
      ],
    },
    select: {
      slug: true,
      name: true,
      description: true,
      scope: true,
      isDefault: true,
      config: true,
      tools: {
        include: {
          tool: { select: { slug: true, source: true, description: true } },
        },
      },
      skills: {
        include: {
          skill: { select: { slug: true, name: true, description: true } },
        },
      },
    },
    orderBy: [{ scope: "asc" }, { name: "asc" }],
  });

  if (agents.length === 0) {
    return "## Live Agent Catalog\n\n_No agents are currently available._";
  }

  const lines: string[] = [
    "## Live Agent Catalog (generated at run time — use only this list)",
    "",
    "Each entry shows the agent slug (for internal identification), display name, visibility, and what it is best at.",
    "",
  ];

  for (const agent of agents) {
    const visibility = agent.scope === "global" ? "global" : "personal";
    const defaultLabel = agent.isDefault ? " · default" : "";

    lines.push(`### ${agent.slug} — ${agent.name} (${visibility}${defaultLabel})`);

    if (agent.description) {
      lines.push(`**Description:** ${agent.description}`);
    }

    // Derive capability hints from config.tools
    const toolsConfig = parseToolsConfig(agent.config as Record<string, unknown> | null | undefined);
    const capabilityParts: string[] = [];

    if (toolsConfig?.subagents && toolsConfig.subagents.length > 0) {
      capabilityParts.push(`Subagents: ${toolsConfig.subagents.join(", ")}`);
    }
    if (toolsConfig?.custom && toolsConfig.custom.length > 0) {
      capabilityParts.push(`Custom tools: ${toolsConfig.custom.join(", ")}`);
    }
    if (toolsConfig?.direct && toolsConfig.direct.length > 0) {
      capabilityParts.push(`Direct MCP tools: ${toolsConfig.direct.join(", ")}`);
    }

    // Fall back to attached tool rows if config.tools wasn't set
    if (capabilityParts.length === 0 && agent.tools.length > 0) {
      const toolSlugs = agent.tools.map((at) => at.tool.slug).join(", ");
      capabilityParts.push(`Tools: ${toolSlugs}`);
    }

    if (capabilityParts.length > 0) {
      lines.push(`**Capabilities:** ${capabilityParts.join(" · ")}`);
    }

    if (agent.skills.length > 0) {
      const skillNames = agent.skills.map((as) => as.skill.name).join(", ");
      lines.push(`**Skills:** ${skillNames}`);
    }

    lines.push("");
  }

  lines.push(
    "---",
    "",
    "**Routing rules:**",
    "- When suggesting an agent to the user, always use the **display name** (e.g. the `name` field), not the slug.",
    "- Internally you may reference the slug to identify agents, but never surface raw slugs in your replies.",
    "- If no specific agent fits, tell the user honestly that no agent currently covers their use case.",
    "- Never execute tasks yourself — delegate by suggesting the right agent by name.",
    "",
  );

  return lines.join("\n");
}
