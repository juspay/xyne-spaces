import { Prisma } from "@prisma/client";
import { prisma } from "../src/db.js";
import { parseToolsConfig, SUBAGENT_DEFINITIONS } from "xyne-claw-shared";

const AGENT_INCLUDE = {
  tools: { include: { tool: { select: { slug: true } } } },
  skills: { include: { skill: { include: { files: true } } } },
} satisfies Prisma.AgentInclude;

const SUBAGENT_INCLUDE = {
  skills: { include: { skill: { include: { files: true } } } },
} satisfies Prisma.SubagentDefinitionInclude;

type SkillRow = Prisma.SkillGetPayload<{ include: { files: true } }>;
type AgentRow = Prisma.AgentGetPayload<{ include: typeof AGENT_INCLUDE }>;
type SubagentRow = Prisma.SubagentDefinitionGetPayload<{ include: typeof SUBAGENT_INCLUDE }>;

type Bundle = {
  version: 1;
  exportedAt: string;
  sourceOrg: { id: string; name: string };
  agent: Omit<AgentRow, "tools" | "skills"> & { toolLinks: Array<{ slug: string; permission: string }>; skillIds: string[] };
  skills: SkillRow[];
  subagents: Array<Omit<SubagentRow, "skills"> & { skillIds: string[] }>;
  builtinSubagents: string[];
  missingSubagents: string[];
};

const builtinSubagentNames = new Set(SUBAGENT_DEFINITIONS.map((d) => d.name));

function usage(): never {
  console.error(
    [
      "Usage:",
      "  npx tsx scripts/port-agent-across-envs.ts export --slug <agent-slug> --from-org <org-name>            # JSON bundle on stdout",
      "  npx tsx scripts/port-agent-across-envs.ts import --to-org <org-name> [--owner <email>] [--dry-run] [--force] < bundle.json",
    ].join("\n"),
  );
  process.exit(1);
}

function parseArgs(argv: string[]): { mode: "export" | "import"; slug?: string; fromOrg?: string; toOrg?: string; owner?: string; dryRun: boolean; force: boolean } {
  const mode = argv[0];
  if (mode !== "export" && mode !== "import") usage();
  const out: ReturnType<typeof parseArgs> = { mode, dryRun: false, force: false };
  for (let i = 1; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--dry-run") { out.dryRun = true; continue; }
    if (arg === "--force") { out.force = true; continue; }
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) usage();
    if (arg === "--slug") out.slug = next;
    else if (arg === "--from-org") out.fromOrg = next;
    else if (arg === "--to-org") out.toOrg = next;
    else if (arg === "--owner") out.owner = next;
    else usage();
    i++;
  }
  if (mode === "export" && (!out.slug || !out.fromOrg)) usage();
  if (mode === "import" && !out.toOrg) usage();
  return out;
}

function asRecord(value: Prisma.JsonValue | null): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

function uniqueStrings(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  return [...new Set(values.filter((v): v is string => typeof v === "string" && v.length > 0))];
}

function rewriteJsonIds(value: Prisma.JsonValue | null, idMap: Map<string, string>): Prisma.InputJsonValue | null {
  if (typeof value === "string") return idMap.get(value) ?? value;
  if (Array.isArray(value)) return value.map((item) => rewriteJsonIds(item as Prisma.JsonValue, idMap)) as Prisma.InputJsonArray;
  if (value && typeof value === "object") {
    const out: Record<string, Prisma.InputJsonValue | null> = {};
    for (const [key, item] of Object.entries(value)) out[key] = rewriteJsonIds(item as Prisma.JsonValue, idMap);
    return out as Prisma.InputJsonObject;
  }
  return value as Prisma.InputJsonValue | null;
}

async function exportBundle(slug: string, fromOrg: string): Promise<Bundle> {
  const sourceOrg = await prisma.organization.findUnique({ where: { name: fromOrg }, select: { id: true, name: true } });
  if (!sourceOrg) throw new Error(`Source org not found by name: ${fromOrg}`);
  const agent = await prisma.agent.findUnique({ where: { orgId_slug: { orgId: sourceOrg.id, slug } }, include: AGENT_INCLUDE });
  if (!agent) throw new Error(`Source agent not found: ${fromOrg}/${slug}`);

  const skills = new Map<string, SkillRow>();
  for (const link of agent.skills) skills.set(link.skill.id, link.skill);

  const subagents = new Map<string, SubagentRow>();
  const builtin = new Set<string>();
  const missing = new Set<string>();
  const queue = uniqueStrings(parseToolsConfig(asRecord(agent.config))?.subagents);
  for (let i = 0; i < queue.length; i++) {
    const name = queue[i]!;
    if (builtinSubagentNames.has(name)) { builtin.add(name); continue; }
    const row = await prisma.subagentDefinition.findUnique({ where: { orgId_name: { orgId: sourceOrg.id, name } }, include: SUBAGENT_INCLUDE });
    if (!row) { missing.add(name); continue; }
    if (subagents.has(row.id)) continue;
    subagents.set(row.id, row);
    for (const link of row.skills) skills.set(link.skill.id, link.skill);
    for (const nested of uniqueStrings(parseToolsConfig({ tools: asRecord(row.tools) ?? row.tools })?.subagents)) {
      if (!queue.includes(nested)) queue.push(nested);
    }
  }

  const { tools, skills: agentSkills, ...agentRest } = agent;
  agentRest.spacesAppToken = null;
  agentRest.signingSecret = null;
  agentRest.spacesAppId = null;
  agentRest.spacesAppUserId = null;
  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    sourceOrg,
    agent: {
      ...agentRest,
      toolLinks: tools.map((link) => ({ slug: link.tool.slug, permission: link.permission })),
      skillIds: agentSkills.map((link) => link.skill.id),
    },
    skills: [...skills.values()],
    subagents: [...subagents.values()].map(({ skills: links, ...rest }) => ({ ...rest, skillIds: links.map((l) => l.skill.id) })),
    builtinSubagents: [...builtin].sort(),
    missingSubagents: [...missing].sort(),
  };
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

async function importBundle(bundle: Bundle, toOrg: string, owner: string | undefined, dryRun: boolean, force: boolean): Promise<void> {
  if (bundle.version !== 1) throw new Error(`Unsupported bundle version ${String(bundle.version)}`);
  const targetOrg = await prisma.organization.findUnique({ where: { name: toOrg }, select: { id: true, name: true } });
  if (!targetOrg) throw new Error(`Target org not found by name: ${toOrg}`);

  let ownerUserId: string | null = null;
  if (owner) {
    const user = await prisma.user.findFirst({ where: { email: owner, orgId: targetOrg.id }, select: { id: true } });
    if (!user) throw new Error(`Owner not found by email in target org: ${owner}`);
    ownerUserId = user.id;
  }

  const slug = bundle.agent.slug;
  const existingAgent = await prisma.agent.findUnique({ where: { orgId_slug: { orgId: targetOrg.id, slug } }, select: { id: true } });
  const [existingSkills, existingSubagents, targetTools] = await Promise.all([
    prisma.skill.findMany({ where: { orgId: targetOrg.id, slug: { in: bundle.skills.map((s) => s.slug) } }, select: { id: true, slug: true } }),
    prisma.subagentDefinition.findMany({ where: { orgId: targetOrg.id, name: { in: bundle.subagents.map((s) => s.name) } }, select: { id: true, name: true } }),
    prisma.tool.findMany({ where: { slug: { in: bundle.agent.toolLinks.map((t) => t.slug) } }, select: { id: true, slug: true } }),
  ]);
  const skillBySlug = new Map(existingSkills.map((s) => [s.slug, s.id]));
  const subagentByName = new Map(existingSubagents.map((s) => [s.name, s.id]));
  const toolBySlug = new Map(targetTools.map((t) => [t.slug, t.id]));
  const missingTools = bundle.agent.toolLinks.filter((t) => !toolBySlug.has(t.slug)).map((t) => t.slug);

  console.log(`Port plan: ${bundle.sourceOrg.name}/${slug} (exported ${bundle.exportedAt}) -> ${targetOrg.name}/${slug}`);
  console.log(`Agent: ${bundle.agent.name} (${existingAgent ? "target exists" : "will create"})`);
  console.log(`Skills: ${bundle.skills.length} (${bundle.skills.filter((s) => !skillBySlug.has(s.slug)).length} create)`);
  console.log(`Custom subagents: ${bundle.subagents.length} (${bundle.subagents.filter((s) => !subagentByName.has(s.name)).length} create)`);
  console.log(`Builtin subagents: ${bundle.builtinSubagents.join(", ") || "none"}`);
  if (bundle.missingSubagents.length) console.log(`Subagents missing in source: ${bundle.missingSubagents.join(", ")}`);
  console.log(`Tool links: ${bundle.agent.toolLinks.length}${missingTools.length ? ` (missing in target, skipped: ${missingTools.join(", ")})` : ""}`);
  console.log("Not ported: shares, MCP connections, provider credentials, KB collections, Spaces app identity, prompt versions.");

  if (existingAgent && !force) {
    console.log("Write guard: target agent exists; re-run with --force to overwrite.");
    if (!dryRun) throw new Error(`Target agent ${targetOrg.name}/${slug} already exists.`);
  }
  if (dryRun) { console.log("Dry run: no DB writes performed."); return; }

  const agentId = await prisma.$transaction(async (tx) => {
    const idMap = new Map<string, string>([[bundle.sourceOrg.id, targetOrg.id]]);

    for (const skill of bundle.skills) {
      const existing = skillBySlug.get(skill.slug);
      if (existing) { idMap.set(skill.id, existing); console.log(`skill reused: ${skill.slug}`); continue; }
      const created = await tx.skill.create({
        data: {
          slug: skill.slug, name: skill.name, label: skill.label, description: skill.description, content: skill.content,
          source: skill.source, scope: skill.scope, enabled: skill.enabled, ownerUserId: null, promotedBy: null, promotedAt: null,
          orgId: targetOrg.id,
          files: { create: skill.files.map((f) => ({ relativePath: f.relativePath, content: f.content, contentType: f.contentType, sizeBytes: f.sizeBytes })) },
        },
        select: { id: true },
      });
      idMap.set(skill.id, created.id);
      console.log(`skill created: ${skill.slug}`);
    }

    const createdSubagents = new Set<string>();
    for (const sub of bundle.subagents) {
      const existing = subagentByName.get(sub.name);
      if (existing) { idMap.set(sub.id, existing); console.log(`subagent reused: ${sub.name}`); continue; }
      const created = await tx.subagentDefinition.create({
        data: {
          name: sub.name, description: sub.description, progressLabels: sub.progressLabels as Prisma.InputJsonValue,
          systemPrompt: sub.systemPrompt, paramName: sub.paramName, paramDescription: sub.paramDescription,
          tools: (sub.tools ?? {}) as Prisma.InputJsonValue,
          mcpInstanceMap: sub.mcpInstanceMap === null ? Prisma.JsonNull : (sub.mcpInstanceMap as Prisma.InputJsonValue),
          enabled: sub.enabled, createdByUserId: ownerUserId, orgId: targetOrg.id,
        },
        select: { id: true },
      });
      idMap.set(sub.id, created.id);
      createdSubagents.add(sub.id);
      console.log(`subagent created: ${sub.name}`);
    }

    for (const sub of bundle.subagents) {
      if (!createdSubagents.has(sub.id)) continue;
      const targetId = idMap.get(sub.id)!;
      const tools = rewriteJsonIds(sub.tools, idMap);
      const mcp = rewriteJsonIds(sub.mcpInstanceMap, idMap);
      await tx.subagentDefinition.update({ where: { id: targetId }, data: { tools: tools ?? {}, mcpInstanceMap: mcp === null ? Prisma.JsonNull : mcp } });
      const skillIds = sub.skillIds.map((id) => idMap.get(id)).filter((id): id is string => Boolean(id));
      if (skillIds.length) await tx.subagentSkill.createMany({ data: skillIds.map((skillId) => ({ subagentDefinitionId: targetId, skillId })), skipDuplicates: true });
    }

    const a = bundle.agent;
    const data = {
      name: a.name, description: a.description, systemPrompt: a.systemPrompt, scope: a.scope, enabled: a.enabled, isDefault: false,
      color: a.color, modelId: a.modelId, config: rewriteJsonIds(a.config, idMap) ?? {}, kbScope: a.kbScope, ownerUserId,
      spacesAppId: null, spacesAppUserId: null, spacesAppToken: null, signingSecret: null,
      activePromptVersionId: null, activePromptVersion: null, promotedBy: null, promotedAt: null,
    } satisfies Prisma.AgentUncheckedUpdateInput;
    const target = existingAgent
      ? await tx.agent.update({ where: { id: existingAgent.id }, data, select: { id: true } })
      : await tx.agent.create({ data: { slug, orgId: targetOrg.id, ...data }, select: { id: true } });

    idMap.set(a.id, target.id);
    await tx.agent.update({ where: { id: target.id }, data: { config: rewriteJsonIds(a.config, idMap) ?? {} } });

    await Promise.all([tx.agentTool.deleteMany({ where: { agentId: target.id } }), tx.agentSkill.deleteMany({ where: { agentId: target.id } })]);
    const toolRows = a.toolLinks.flatMap((t) => { const toolId = toolBySlug.get(t.slug); return toolId ? [{ agentId: target.id, toolId, permission: t.permission }] : []; });
    if (toolRows.length) await tx.agentTool.createMany({ data: toolRows as Prisma.AgentToolCreateManyInput[], skipDuplicates: true });
    const skillRows = a.skillIds.map((id) => idMap.get(id)).filter((id): id is string => Boolean(id)).map((skillId) => ({ agentId: target.id, skillId }));
    if (skillRows.length) await tx.agentSkill.createMany({ data: skillRows, skipDuplicates: true });
    return target.id;
  });

  console.log(`agent ${existingAgent ? "overwritten" : "created"}: ${slug} (${agentId})`);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  try {
    if (args.mode === "export") {
      const bundle = await exportBundle(args.slug!, args.fromOrg!);
      process.stdout.write(JSON.stringify(bundle, null, 2));
      return;
    }
    const bundle = JSON.parse(await readStdin()) as Bundle;
    await importBundle(bundle, args.toOrg!, args.owner, args.dryRun, args.force);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch(async (err) => {
  console.error(err instanceof Error ? err.message : err);
  await prisma.$disconnect();
  process.exit(1);
});
