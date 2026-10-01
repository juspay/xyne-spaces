/**
 * Seed local `xyne` agent = Ask AI capabilities + agent authoring tools.
 *
 * Copies ask-ai prompt/skills/config, then adds every tool from
 * `custom:agent-tools` and `custom:agent-introspect` (create-agent, etc.).
 *
 * Usage (from apps/xyne-claw-auth/backend):
 *   npx tsx scripts/seed-xyne-agent.ts
 *   npx tsx scripts/seed-xyne-agent.ts --force   # overwrite existing xyne
 */
import { Prisma, PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const SLUG = "xyne";
const NAME = "Xyne Agent";
const COLOR = "#e11d48";
const DESCRIPTION =
  "Full Ask AI capabilities plus agent authoring — create, clone, and update agents, subagents, skills, and MCP servers.";

const EXTRA_SOURCES = ["custom:agent-tools", "custom:agent-introspect"] as const;

const AUTHORING_PROMPT_APPENDIX = `

# Agent authoring

You can build and revise agents on this platform. When the user asks to create a new agent:

1. If the ask is vague ("make an agent", "create a bot") with no job: ask what job it should do. At most two questions per turn. Do NOT call \`propose-agent\` yet.
2. Once a job is named, call \`list_available_tools\` (and \`list_agents\` / \`get_agent_config\` when useful). If the job can send, delete, pay, force-push, or post publicly, ask one closed risk question first.
3. Prefer a thin system prompt (Identity, numbered Operational Workflow, tool usage, Guardrails, decision rules, error recovery, two contrastive examples). Put long procedures in a skill via \`create-skill\`, then pass that slug in \`skillSlugs\`.
4. Call \`propose-agent\` exactly once with name, description, systemPrompt, tools, optional \`permissionMode\` (ask-first | read-only | can-write; default ask-first), \`skillSlugs\`, and \`deniedTools\`. That posts a draft card — nothing is created until they approve.
5. Do NOT use \`create-agent\` for brand-new agents (legacy card). Do not claim the agent exists until they approve.

For clone/update of existing agents, subagents, skills, or MCP servers, use the matching write tool (\`clone-agent\`, \`update-agent\`, \`create-subagent\`, \`update-subagent\`, \`create-skill\`, \`update-skill\`, \`create-mcp\`). Those remain approval-gated.
`;

function asRecord(value: Prisma.JsonValue | null | undefined): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? { ...(value as Record<string, unknown>) }
    : {};
}

function uniqueStrings(values: unknown[]): string[] {
  return [...new Set(values.filter((v): v is string => typeof v === "string" && v.length > 0))];
}

async function main() {
  const force = process.argv.includes("--force");

  const askAi = await prisma.agent.findFirst({
    where: { slug: "ask-ai" },
    include: {
      tools: { include: { tool: { select: { id: true, slug: true } } } },
      skills: { include: { skill: { select: { id: true, slug: true } } } },
    },
  });
  if (!askAi) {
    throw new Error("ask-ai agent not found — run claw-auth prisma seed first");
  }

  const existing = await prisma.agent.findUnique({
    where: { orgId_slug: { orgId: askAi.orgId, slug: SLUG } },
    select: { id: true },
  });
  if (existing && !force) {
    console.log(`[seed-xyne] ${SLUG} already exists (id=${existing.id}). Re-run with --force to overwrite.`);
    return;
  }

  const extraTools = await prisma.tool.findMany({
    where: { source: { in: [...EXTRA_SOURCES] } },
    select: { id: true, slug: true, source: true },
    orderBy: { slug: "asc" },
  });
  if (extraTools.length === 0) {
    throw new Error(`No tools found for sources ${EXTRA_SOURCES.join(", ")} — re-seed tools catalog`);
  }

  const askConfig = asRecord(askAi.config);
  const askTools = asRecord(askConfig.tools);
  const custom = uniqueStrings([
    ...((askTools.custom as unknown[]) ?? []),
    ...extraTools.map((t) => t.slug),
  ]);

  const config: Prisma.InputJsonObject = {
    ...askConfig,
    // Enables terminal propose-agent → new DraftAgentCard (not legacy create-agent card).
    agentAuthoring: true,
    tools: {
      subagents: askTools.subagents ?? ["spaces", "artifacts", "google"],
      direct: askTools.direct ?? [],
      custom,
    },
  };

  const systemPrompt = `${askAi.systemPrompt ?? ""}${AUTHORING_PROMPT_APPENDIX}`;

  const agent = await prisma.agent.upsert({
    where: { orgId_slug: { orgId: askAi.orgId, slug: SLUG } },
    create: {
      slug: SLUG,
      orgId: askAi.orgId,
      name: NAME,
      description: DESCRIPTION,
      systemPrompt,
      scope: "global",
      color: COLOR,
      config,
    },
    update: {
      name: NAME,
      description: DESCRIPTION,
      systemPrompt,
      scope: "global",
      color: COLOR,
      config,
    },
  });

  // Mirror ask-ai AgentTool links + every authoring/introspect tool.
  const toolIds = new Map<string, string>();
  for (const link of askAi.tools) toolIds.set(link.tool.id, link.permission);
  for (const t of extraTools) toolIds.set(t.id, "allow");

  for (const [toolId, permission] of toolIds) {
    await prisma.agentTool.upsert({
      where: { agentId_toolId: { agentId: agent.id, toolId } },
      create: { agentId: agent.id, toolId, permission },
      update: { permission },
    });
  }

  for (const link of askAi.skills) {
    await prisma.agentSkill.upsert({
      where: { agentId_skillId: { agentId: agent.id, skillId: link.skill.id } },
      create: { agentId: agent.id, skillId: link.skill.id },
      update: {},
    });
  }

  console.log(`[seed-xyne] Upserted ${SLUG} (id=${agent.id})`);
  console.log(`[seed-xyne] custom tools: ${custom.length} (added ${extraTools.map((t) => t.slug).join(", ")})`);
  console.log(`[seed-xyne] skills: ${askAi.skills.map((s) => s.skill.slug).join(", ")}`);
  if (!agent.spacesAppId) {
    console.log(
      `[seed-xyne] No Spaces app yet — run from apps/backend to make @mentions work:\n` +
        `  pnpm exec dotenv -e .env.local -- pnpm exec tsx scripts/seed-claw-agent-apps.ts`,
    );
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
