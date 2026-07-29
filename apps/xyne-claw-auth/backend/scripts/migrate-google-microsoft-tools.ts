/**
 * One-time migration: agent.config.tools custom → MCP connector, for the
 * google/microsoft move from in-process custom tools to claw-auth-hosted stdio
 * MCP connectors (see mcp/servers/google-server.ts, mcp/adapters/google.ts).
 *
 * Rules (faithful — preserves each agent's exact tool surface):
 *   • Move every `google-*` / `microsoft-*` slug from tools.custom[] into
 *     tools.direct[] (same slug = same live MCP tool name; run.ts surfaces a
 *     direct pick on the parent without needing the whole subagent).
 *   • Legacy dedicated slugs `google-agent` / `microsoft-agent` historically got
 *     the FULL toolset via an agentSlug allow (not via config). For those, add
 *     the whole connector to tools.subagents[] instead of per-tool direct picks.
 *
 * SAFETY:
 *   • Dry-run by default — prints a per-agent diff and a summary. Pass `--apply`
 *     to write changes.
 *   • Agents with NO `tools` object are left untouched (no tools filter = they
 *     already see every resolved connector, incl. the new google/microsoft MCP).
 *     Legacy-slug agents in this state are listed under "REVIEW" so you can
 *     confirm they still resolve google/microsoft via a userMcpConnection.
 *
 * Run from xyne-claw-auth/backend:
 *   tsx --env-file=.env scripts/migrate-google-microsoft-tools.ts          # dry-run
 *   tsx --env-file=.env scripts/migrate-google-microsoft-tools.ts --apply  # write
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const APPLY = process.argv.includes("--apply");

interface ToolsConfig {
  subagents?: string[];
  direct?: string[];
  custom?: string[];
  [k: string]: unknown;
}

const uniq = (xs: string[]): string[] => [...new Set(xs)];

function migrateTools(slug: string, tools: ToolsConfig): { next: ToolsConfig; changed: boolean } {
  const custom = tools.custom ?? [];
  const direct = tools.direct ?? [];
  const subagents = tools.subagents ?? [];

  const googleSlugs = custom.filter((s) => s.startsWith("google-"));
  const microsoftSlugs = custom.filter((s) => s.startsWith("microsoft-"));
  const isGoogleLegacy = slug === "google-agent";
  const isMicrosoftLegacy = slug === "microsoft-agent";

  if (googleSlugs.length === 0 && microsoftSlugs.length === 0 && !isGoogleLegacy && !isMicrosoftLegacy) {
    return { next: tools, changed: false };
  }

  const nextCustom = custom.filter((s) => !s.startsWith("google-") && !s.startsWith("microsoft-"));
  let nextDirect = [...direct];
  let nextSubagents = [...subagents];

  // Google
  if (isGoogleLegacy) {
    nextSubagents.push("google"); // full connector
  } else if (googleSlugs.length > 0) {
    nextDirect.push(...googleSlugs); // exact subset, now MCP tool names
  }
  // Microsoft
  if (isMicrosoftLegacy) {
    nextSubagents.push("microsoft");
  } else if (microsoftSlugs.length > 0) {
    nextDirect.push(...microsoftSlugs);
  }

  const next: ToolsConfig = {
    ...tools,
    subagents: uniq(nextSubagents),
    direct: uniq(nextDirect),
    custom: nextCustom,
  };
  return { next, changed: true };
}

async function main(): Promise<void> {
  const agents = await prisma.agent.findMany({ select: { id: true, slug: true, config: true } });
  let changedCount = 0;
  const review: string[] = [];

  for (const agent of agents) {
    const config = (agent.config ?? {}) as Record<string, unknown>;
    const tools = config["tools"] as ToolsConfig | undefined;

    if (!tools || typeof tools !== "object") {
      if (agent.slug === "google-agent" || agent.slug === "microsoft-agent") {
        review.push(`  REVIEW ${agent.slug} (${agent.id}): no tools config — relies on unfiltered access; confirm google/microsoft userMcpConnection exists.`);
      }
      continue;
    }

    const { next, changed } = migrateTools(agent.slug, tools);
    if (!changed) continue;
    changedCount += 1;

    console.log(`\n• ${agent.slug} (${agent.id})`);
    console.log(`    custom:    ${JSON.stringify(tools.custom ?? [])}  →  ${JSON.stringify(next.custom)}`);
    console.log(`    direct:    ${JSON.stringify(tools.direct ?? [])}  →  ${JSON.stringify(next.direct)}`);
    console.log(`    subagents: ${JSON.stringify(tools.subagents ?? [])}  →  ${JSON.stringify(next.subagents)}`);

    if (APPLY) {
      await prisma.agent.update({
        where: { id: agent.id },
        data: { config: { ...config, tools: next } },
      });
    }
  }

  console.log(`\n${"=".repeat(60)}`);
  console.log(`Agents scanned:  ${agents.length}`);
  console.log(`Agents changed:  ${changedCount}`);
  if (review.length > 0) {
    console.log(`\nNeeds manual review (${review.length}):`);
    console.log(review.join("\n"));
  }
  console.log(APPLY ? "\nAPPLIED changes to the database." : "\nDRY-RUN only. Re-run with --apply to write.");
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
