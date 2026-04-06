import { PrismaClient, type Prisma } from "@prisma/client";
import { getAllCustomTools } from "xyne-claw-shared";

const prisma = new PrismaClient();

const SERVERS = [
  {
    type: "kibana",
    name: "Kibana",
    url: "",
    description: "Elasticsearch Kibana instance for log search and dashboards",
  },
  {
    type: "grafana",
    name: "Grafana",
    url: "",
    description: "Grafana instance for metrics and alerting dashboards",
  },
  {
    type: "bitbucket",
    name: "Bitbucket",
    url: "",
    description: "Bitbucket Cloud integration via @aashari/mcp-server-atlassian-bitbucket",
  },
  {
    type: "xyne-spaces",
    name: "Xyne Spaces",
    url: "",
    description: "Internal Xyne Spaces platform integration",
  },
] as const;

async function main() {
  for (const server of SERVERS) {
    await prisma.mcpServer.upsert({
      where: { type: server.type },
      create: server,
      update: { name: server.name, url: server.url, description: server.description },
    });
    console.log(`[seed] Upserted server: ${server.name} (${server.type})`);
  }

  const stale = await prisma.mcpServer.findFirst({ where: { type: "atlassian" } });
  if (stale) {
    await prisma.mcpServer.delete({ where: { id: stale.id } });
    console.log("[seed] Removed stale atlassian server");
  }

  // Seed default gateways
  const GATEWAYS = [
    { type: "xyne-spaces", name: "Xyne Spaces" },
  ] as const;

  for (const gw of GATEWAYS) {
    await prisma.gateway.upsert({
      where: { type: gw.type },
      create: gw,
      update: { name: gw.name },
    });
    console.log(`[seed] Upserted gateway: ${gw.name} (${gw.type})`);
  }

  // Seed builtin tools
  const BUILTIN_TOOLS = [
    { slug: "builtin__bash", name: "bash", description: "Execute shell commands", source: "builtin" },
    { slug: "builtin__read", name: "read", description: "Read files", source: "builtin" },
    { slug: "builtin__write", name: "write", description: "Write files", source: "builtin" },
    { slug: "builtin__edit", name: "edit", description: "Edit files", source: "builtin" },
    { slug: "builtin__grep", name: "grep", description: "Search file contents with regex", source: "builtin" },
    { slug: "builtin__find", name: "find", description: "Find files by pattern", source: "builtin" },
    { slug: "builtin__ls", name: "ls", description: "List directory contents", source: "builtin" },
  ] as const;

  for (const tool of BUILTIN_TOOLS) {
    await prisma.tool.upsert({
      where: { slug: tool.slug },
      create: tool,
      update: { name: tool.name, description: tool.description },
    });
  }
  console.log(`[seed] Upserted ${BUILTIN_TOOLS.length} builtin tools`);

  // Seed custom tools from shared registry
  const customTools = getAllCustomTools();
  for (const ct of customTools) {
    await prisma.tool.upsert({
      where: { slug: ct.slug },
      create: {
        slug: ct.slug,
        name: ct.name,
        description: ct.description,
        source: ct.source,
        inputSchema: ct.inputSchema as Prisma.InputJsonValue,
      },
      update: {
        name: ct.name,
        description: ct.description,
        inputSchema: ct.inputSchema as Prisma.InputJsonValue,
      },
    });
  }
  console.log(`[seed] Upserted ${customTools.length} custom tools from shared registry`);

  // Seed digital-twin agent (default — all unrouted calls go here)
  const DIGITAL_TWIN_PROMPT = `You are the **Digital Twin** of the user. You act, think, and respond exactly as this person would.

## Identity
You ARE this user's digital representative. Respond the way this person would, using their knowledge, context, communication style, and expertise.

## How to Build Context (do this FIRST)
Before answering any query, gather the user's context using Xyne Spaces tools:
1. **Recent activity** — Use spaces-activity to understand what the user is currently working on.
2. **Knowledge base** — Use spaces-memory-search to find documented facts and SOPs.
3. **Messages & conversations** — Use spaces-messages to understand communication style.
4. **Tickets & work items** — Use spaces-tickets to see current workload and priorities.
5. **Search** — Use spaces-search to find relevant messages, files, or tickets.
6. **People lookup** — Use spaces-users when you need to identify people.

## How to Respond
- Mirror the user's communication style.
- Ground every answer in data from tools. Do not guess.
- For engineering queries — use Bitbucket, Kibana, or Grafana tools.
- Respond in first person ("I", "my", "we") as the user.
- Acknowledge gaps honestly.

## Write Actions & Approvals
Some tools (like creating tickets or scheduling calls) require user approval before executing. When you call these tools, they will return "Action queued for approval". This is NORMAL — it means:
- The action details have been sent to the user as an Approve/Decline button
- The user will see the action details and can approve or decline
- You should tell the user: "I've queued the action for your approval — check for the Approve button."
- Do NOT retry or treat this as an error. The action will execute when the user approves.

## Critical Rules
1. NEVER fabricate information. Only use data retrieved from tools.
2. ALWAYS gather context before responding.
3. Respond as the user, not as an assistant describing the user.
4. When a tool returns "Action queued for approval", tell the user to approve it — do NOT retry.`;

  await prisma.agent.upsert({
    where: { slug: "assistant" },
    create: {
      slug: "assistant",
      name: "Assistant",
      description: "Acts as the user's digital representative — the default agent for all calls.",
      systemPrompt: DIGITAL_TWIN_PROMPT,
      scope: "global",
      isDefault: true,
      color: "#6366f1",
      config: {
        toolPermissions: {
          "xyne-spaces__spaces-create-ticket": "ask",
          "xyne-spaces__spaces-schedule-call": "ask",
        },
      },
    },
    update: {
      name: "Assistant",
      description: "Acts as the user's digital representative — the default agent for all calls.",
      systemPrompt: DIGITAL_TWIN_PROMPT,
      isDefault: true,
      config: {
        toolPermissions: {
          "xyne-spaces__spaces-create-ticket": "ask",
          "xyne-spaces__spaces-schedule-call": "ask",
        },
      },
    },
  });
  console.log("[seed] Upserted assistant agent (default)");

  // Seed pgm-agent (Program Manager)
  const PGM_AGENT_PROMPT = [
    "You are a Program Manager agent. Your job is to help the user drive programs (goals) to closure by tracking tasks, evaluating success criteria, detecting risks, and resolving blockers.",
    "",
    "## Data Model",
    "All data is stored as Quarto books in a git-managed data repo. Each program is a directory under `programs/` containing:",
    "- `_quarto.yml` — Book configuration with parts for Tasks and Agent Runs",
    "- `index.qmd` — Program overview with YAML frontmatter (status, criteria, policy, channel) and Markdown prose",
    "- `tasks/*.qmd` — One file per task with frontmatter (status, owner, deadline, tickets) and Markdown body",
    "- `runs/*.qmd` — One file per agent run/sweep with frontmatter (date, trigger) and Markdown body",
    "- `runs/_index.qmd` — Summary table of all runs",
    "",
    "## Git Workflow",
    "- **Always pgm-pull before reading** to get the latest state",
    "- **Always pgm-commit + pgm-push after writing** to persist and share changes",
    "- Use meaningful commit messages that describe what changed and why",
    "",
    "## How you work",
    "1. **Create a program** — The user describes a goal. You create a program and help structure it into tasks with owners, success criteria, and stakeholders.",
    "2. **Track progress** — Read program and task files, evaluate success criteria, detect risks, and write findings as runs.",
    "3. **Resolve blockers** — Identify blockers, figure out who can help, and track resolution.",
    "4. **Sweep** — Run periodic evaluations: read all tasks, check criteria, detect risks, and write a run report.",
    "",
    "## Workflow",
    "### Phase 1: Gather Intent — Take whatever the user gives you. Check for existing programs with pgm-list-programs.",
    "### Phase 2: Workspace Discovery — Use Spaces tools (via delegation) to find related tickets, users, channels.",
    "### Phase 3: Draft Review — Present a full draft to the user for approval before creating anything.",
    "### Phase 4: Create & Activate — Only after approval, create the program, tasks, and commit.",
    "",
    "## Sweep Workflow",
    "1. pgm-pull, read all tasks, evaluate criteria",
    "2. Check Spaces for ticket progress, activity, messages about blockers",
    "3. Write a run report with pgm-write-run, then pgm-commit + pgm-push",
    "",
    "## Guidelines",
    "- Never expose internal IDs in chat — use human-readable names",
    "- Always confirm names with the user before creating",
    "- Program statuses: draft, active, paused, completed, archived",
    "- Task statuses: not_started, in_progress, blocked, completed, cancelled",
  ].join("\n");

  const pgmAgent = await prisma.agent.upsert({
    where: { slug: "pgm-agent" },
    create: {
      slug: "pgm-agent",
      name: "Program Manager",
      description: "Drives programs to closure — tracks tasks, evaluates success criteria, detects risks, resolves blockers.",
      systemPrompt: PGM_AGENT_PROMPT,
      scope: "global",
      color: "#8b5cf6",
    },
    update: {
      name: "Program Manager",
      description: "Drives programs to closure — tracks tasks, evaluates success criteria, detects risks, resolves blockers.",
      systemPrompt: PGM_AGENT_PROMPT,
    },
  });

  // Attach pgm tools to the pgm-agent
  const pgmToolSlugs = customTools.filter((t) => t.source === "custom:pgm").map((t) => t.slug);
  for (const slug of pgmToolSlugs) {
    const tool = await prisma.tool.findUnique({ where: { slug } });
    if (tool) {
      await prisma.agentTool.upsert({
        where: { agentId_toolId: { agentId: pgmAgent.id, toolId: tool.id } },
        create: { agentId: pgmAgent.id, toolId: tool.id, permission: "allow" },
        update: { permission: "allow" },
      });
    }
  }
  console.log(`[seed] Upserted pgm-agent with ${pgmToolSlugs.length} tools`);
}

main()
  .catch((err: unknown) => {
    console.error("[seed] Error:", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
