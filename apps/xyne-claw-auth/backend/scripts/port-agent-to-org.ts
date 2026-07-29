import { Prisma } from "@prisma/client";
import { prisma } from "../src/db.js";
import { parseToolsConfig, SUBAGENT_DEFINITIONS } from "xyne-claw-shared";

const SOURCE_AGENT_INCLUDE = {
  tools: { include: { tool: true } },
  skills: { include: { skill: { include: { files: true } } } },
  collections: true,
  shares: true,
  mcpConnections: true,
  providerCredentials: true,
} satisfies Prisma.AgentInclude;

const SOURCE_SUBAGENT_INCLUDE = {
  skills: { include: { skill: { include: { files: true } } } },
  shares: true,
} satisfies Prisma.SubagentDefinitionInclude;

type SourceSkill = Prisma.SkillGetPayload<{ include: { files: true } }>;
type SourceAgent = Prisma.AgentGetPayload<{ include: typeof SOURCE_AGENT_INCLUDE }>;
type SourceSubagent = Prisma.SubagentDefinitionGetPayload<{ include: typeof SOURCE_SUBAGENT_INCLUDE }>;

type Args = {
  slug: string;
  fromOrg: string;
  toOrg: string;
  owner?: string;
  dryRun: boolean;
  force: boolean;
};

type RewriteNote = {
  context: string;
  path: string;
  from: string;
  to: string;
};

type GraphPlan = {
  sourceOrg: { id: string; name: string };
  targetOrg: { id: string; name: string };
  agent: SourceAgent;
  agentSubagentNames: string[];
  builtinSubagents: string[];
  missingSubagents: string[];
  subagents: SourceSubagent[];
  skills: SourceSkill[];
  ownerUserId: string | null;
  targetAgentExists: boolean;
  targetSkillBySourceId: Map<string, { id: string | null; action: "reused" | "create"; slug: string }>;
  targetSubagentBySourceId: Map<string, { id: string | null; action: "reused" | "create"; name: string }>;
};

const builtinSubagentNames = new Set(SUBAGENT_DEFINITIONS.map((d) => d.name));

function usage(): never {
  console.error(
    "Usage: npx tsx scripts/port-agent-to-org.ts --slug <agent-slug> --from-org <org-name> --to-org <org-name> [--owner <email>] [--dry-run] [--force]",
  );
  process.exit(1);
}

function parseArgs(argv: string[]): Args {
  const args: Partial<Args> = { dryRun: false, force: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--dry-run") {
      args.dryRun = true;
      continue;
    }
    if (arg === "--force") {
      args.force = true;
      continue;
    }
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) usage();
    if (arg === "--slug") args.slug = next;
    else if (arg === "--from-org") args.fromOrg = next;
    else if (arg === "--to-org") args.toOrg = next;
    else if (arg === "--owner") args.owner = next;
    else usage();
    i++;
  }

  if (!args.slug || !args.fromOrg || !args.toOrg) usage();
  if (args.fromOrg === args.toOrg) throw new Error("--from-org and --to-org must be different");
  return args as Args;
}

function asConfigRecord(value: Prisma.JsonValue): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function uniqueStrings(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  return [...new Set(values.filter((v): v is string => typeof v === "string" && v.length > 0))];
}

function subagentNamesFromConfig(config: Prisma.JsonValue): string[] {
  return uniqueStrings(parseToolsConfig(asConfigRecord(config))?.subagents);
}

function subagentNamesFromTools(tools: Prisma.JsonValue): string[] {
  return uniqueStrings(parseToolsConfig({ tools: asConfigRecord(tools) ?? tools })?.subagents);
}

function addSkill(skills: Map<string, SourceSkill>, skill: SourceSkill): void {
  if (!skills.has(skill.id)) skills.set(skill.id, skill);
}

async function buildGraph(args: Args): Promise<GraphPlan> {
  const [sourceOrg, targetOrg] = await Promise.all([
    prisma.organization.findUnique({ where: { name: args.fromOrg }, select: { id: true, name: true } }),
    prisma.organization.findUnique({ where: { name: args.toOrg }, select: { id: true, name: true } }),
  ]);
  if (!sourceOrg) throw new Error(`Source org not found by name: ${args.fromOrg}`);
  if (!targetOrg) throw new Error(`Target org not found by name: ${args.toOrg}`);

  const [agent, targetAgent] = await Promise.all([
    prisma.agent.findUnique({
      where: { orgId_slug: { orgId: sourceOrg.id, slug: args.slug } },
      include: SOURCE_AGENT_INCLUDE,
    }),
    prisma.agent.findUnique({
      where: { orgId_slug: { orgId: targetOrg.id, slug: args.slug } },
      select: { id: true },
    }),
  ]);
  if (!agent) throw new Error(`Source agent not found by org+slug: ${args.fromOrg}/${args.slug}`);

  let ownerUserId: string | null = null;
  if (args.owner) {
    const owner = await prisma.user.findFirst({
      where: { email: args.owner, orgId: targetOrg.id },
      select: { id: true, email: true },
    });
    if (!owner) throw new Error(`Owner not found by email in target org: ${args.owner}`);
    ownerUserId = owner.id;
  }

  const skills = new Map<string, SourceSkill>();
  for (const link of agent.skills) addSkill(skills, link.skill);

  const subagents = new Map<string, SourceSubagent>();
  const visited = new Set<string>();
  const builtinSubagents = new Set<string>();
  const missingSubagents = new Set<string>();
  const queue = subagentNamesFromConfig(agent.config);
  const agentSubagentNames = [...queue];

  for (let i = 0; i < queue.length; i++) {
    const name = queue[i]!;
    if (builtinSubagentNames.has(name)) {
      builtinSubagents.add(name);
      continue;
    }

    const row = await prisma.subagentDefinition.findUnique({
      where: { orgId_name: { orgId: sourceOrg.id, name } },
      include: SOURCE_SUBAGENT_INCLUDE,
    });
    if (!row) {
      missingSubagents.add(name);
      continue;
    }
    if (visited.has(row.id)) continue;
    visited.add(row.id);
    subagents.set(row.id, row);
    for (const link of row.skills) addSkill(skills, link.skill);

    for (const nestedName of subagentNamesFromTools(row.tools)) {
      if (!queue.includes(nestedName)) queue.push(nestedName);
    }
  }

  const skillEntries = [...skills.values()].sort((a, b) => a.slug.localeCompare(b.slug));
  const subagentEntries = [...subagents.values()].sort((a, b) => a.name.localeCompare(b.name));
  const [targetSkills, targetSubagents] = await Promise.all([
    skillEntries.length === 0
      ? Promise.resolve([])
      : prisma.skill.findMany({
          where: { orgId: targetOrg.id, slug: { in: skillEntries.map((s) => s.slug) } },
          select: { id: true, slug: true },
        }),
    subagentEntries.length === 0
      ? Promise.resolve([])
      : prisma.subagentDefinition.findMany({
          where: { orgId: targetOrg.id, name: { in: subagentEntries.map((s) => s.name) } },
          select: { id: true, name: true },
        }),
  ]);
  const targetSkillBySlug = new Map(targetSkills.map((s) => [s.slug, s.id]));
  const targetSubagentByName = new Map(targetSubagents.map((s) => [s.name, s.id]));

  return {
    sourceOrg,
    targetOrg,
    agent,
    agentSubagentNames,
    builtinSubagents: [...builtinSubagents].sort(),
    missingSubagents: [...missingSubagents].sort(),
    subagents: subagentEntries,
    skills: skillEntries,
    ownerUserId,
    targetAgentExists: Boolean(targetAgent),
    targetSkillBySourceId: new Map(
      skillEntries.map((s) => {
        const targetId = targetSkillBySlug.get(s.slug) ?? null;
        return [s.id, { id: targetId, action: targetId ? "reused" : "create", slug: s.slug }];
      }),
    ),
    targetSubagentBySourceId: new Map(
      subagentEntries.map((s) => {
        const targetId = targetSubagentByName.get(s.name) ?? null;
        return [s.id, { id: targetId, action: targetId ? "reused" : "create", name: s.name }];
      }),
    ),
  };
}

function rewriteJsonIds(
  value: Prisma.JsonValue | Prisma.InputJsonValue | null,
  idMap: Map<string, string>,
  context: string,
  path = "$",
  notes: RewriteNote[] = [],
): { value: Prisma.InputJsonValue | null; notes: RewriteNote[] } {
  if (typeof value === "string") {
    const replacement = idMap.get(value);
    if (replacement) {
      notes.push({ context, path, from: value, to: replacement });
      return { value: replacement, notes };
    }
    return { value, notes };
  }
  if (Array.isArray(value)) {
    return {
      value: value.map((item, index) => rewriteJsonIds(item as Prisma.JsonValue, idMap, context, `${path}[${index}]`, notes).value) as Prisma.InputJsonArray,
      notes,
    };
  }
  if (value && typeof value === "object") {
    const out: Record<string, Prisma.InputJsonValue | null> = {};
    for (const [key, item] of Object.entries(value)) {
      out[key] = rewriteJsonIds(item as Prisma.JsonValue, idMap, context, `${path}.${key}`, notes).value;
    }
    return { value: out as Prisma.InputJsonObject, notes };
  }
  return { value: value as Prisma.InputJsonValue | null, notes };
}

function inspectIdRefs(value: Prisma.JsonValue | null, ids: Set<string>, context: string, path = "$", notes: RewriteNote[] = []): RewriteNote[] {
  if (typeof value === "string") {
    if (ids.has(value)) notes.push({ context, path, from: value, to: "(target id after copy/reuse)" });
    return notes;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => inspectIdRefs(item as Prisma.JsonValue, ids, context, `${path}[${index}]`, notes));
    return notes;
  }
  if (value && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) {
      inspectIdRefs(item as Prisma.JsonValue, ids, context, `${path}.${key}`, notes);
    }
  }
  return notes;
}

function printTree(plan: GraphPlan): void {
  const skillCreate = [...plan.targetSkillBySourceId.values()].filter((s) => s.action === "create").length;
  const skillReuse = plan.skills.length - skillCreate;
  const subagentCreate = [...plan.targetSubagentBySourceId.values()].filter((s) => s.action === "create").length;
  const subagentReuse = plan.subagents.length - subagentCreate;

  console.log(`Port plan: ${plan.sourceOrg.name}/${plan.agent.slug} -> ${plan.targetOrg.name}/${plan.agent.slug}`);
  console.log(`Agent: ${plan.agent.name} (${plan.targetAgentExists ? "target exists" : "will create"})`);
  console.log(`Counts: skills=${plan.skills.length} (${skillCreate} create, ${skillReuse} reused), customSubagents=${plan.subagents.length} (${subagentCreate} create, ${subagentReuse} reused), agentTools=${plan.agent.tools.length}`);
  console.log("Graph:");
  console.log(`- agent ${plan.agent.slug}`);
  if (plan.agent.tools.length > 0) {
    console.log(`  - tools (${plan.agent.tools.length})`);
    for (const link of plan.agent.tools) console.log(`    - ${link.tool.slug} [${link.permission}]`);
  } else {
    console.log("  - tools (0)");
  }
  if (plan.skills.length > 0) {
    console.log(`  - skills (${plan.skills.length})`);
    for (const skill of plan.skills) {
      const action = plan.targetSkillBySourceId.get(skill.id)?.action ?? "create";
      console.log(`    - ${skill.slug} [${action}; files=${skill.files.length}]`);
    }
  } else {
    console.log("  - skills (0)");
  }
  if (plan.agentSubagentNames.length > 0) {
    console.log(`  - subagents (${plan.agentSubagentNames.length} named)`);
    for (const name of plan.agentSubagentNames) {
      if (plan.builtinSubagents.includes(name)) console.log(`    - ${name} [builtin; not copied]`);
      else if (plan.missingSubagents.includes(name)) console.log(`    - ${name} [missing in source org]`);
      else {
        const row = plan.subagents.find((s) => s.name === name);
        const action = row ? plan.targetSubagentBySourceId.get(row.id)?.action ?? "create" : "create";
        console.log(`    - ${name} [custom; ${action}]`);
      }
    }
  } else {
    console.log("  - subagents (0)");
  }
}

function printSkipList(plan: GraphPlan): void {
  console.log("Skipped / manual checklist:");
  console.log(`- Agent shares: ${plan.agent.shares.length} skipped; recreate target-org shares manually.`);
  console.log(`- Subagent shares: ${plan.subagents.reduce((sum, s) => sum + s.shares.length, 0)} skipped; recreate editor grants manually if needed.`);
  console.log(`- Agent MCP connections: ${plan.agent.mcpConnections.length} skipped; configure target-org connector instances manually.`);
  console.log("- User MCP connections: skipped; user-bound OAuth/session connections are not portable.");
  console.log(`- Provider credentials: ${plan.agent.providerCredentials.length} skipped; add target-org agent credentials manually.`);
  console.log(`- KB collections: ${plan.agent.collections.length} skipped; select target-org/user-visible collections manually.`);
  console.log("- Spaces app identity/token/signing secret and prompt-version pointers are reset on the target agent.");
}

function printRewriteNotes(notes: RewriteNote[]): void {
  if (notes.length === 0) {
    console.log("Config ID rewrites: none detected.");
    return;
  }
  console.log("Config ID rewrites:");
  for (const note of notes) console.log(`- ${note.context} ${note.path}: ${note.from} -> ${note.to}`);
}

async function copySkill(
  tx: Prisma.TransactionClient,
  source: SourceSkill,
  targetOrgId: string,
): Promise<{ id: string; action: "reused" | "created" }> {
  const existing = await tx.skill.findUnique({ where: { orgId_slug: { orgId: targetOrgId, slug: source.slug } }, select: { id: true } });
  if (existing) return { id: existing.id, action: "reused" };

  const created = await tx.skill.create({
    data: {
      slug: source.slug,
      name: source.name,
      label: source.label,
      description: source.description,
      content: source.content,
      source: source.source,
      scope: source.scope,
      enabled: source.enabled,
      ownerUserId: null,
      promotedBy: null,
      promotedAt: null,
      orgId: targetOrgId,
      files: {
        create: source.files.map((file) => ({
          relativePath: file.relativePath,
          content: file.content,
          contentType: file.contentType,
          sizeBytes: file.sizeBytes,
        })),
      },
    },
    select: { id: true },
  });
  return { id: created.id, action: "created" };
}

async function executeCopy(plan: GraphPlan, args: Args): Promise<RewriteNote[]> {
  if (plan.targetAgentExists && !args.force) {
    throw new Error(`Target agent ${plan.targetOrg.name}/${plan.agent.slug} already exists. Re-run with --force to overwrite agent fields and junctions.`);
  }

  const rewriteNotes: RewriteNote[] = [];
  const result = await prisma.$transaction(async (tx) => {
    const idMap = new Map<string, string>([[plan.sourceOrg.id, plan.targetOrg.id]]);
    const skillTargetIds = new Map<string, string>();
    const subagentTargetIds = new Map<string, string>();

    for (const skill of plan.skills) {
      const copied = await copySkill(tx, skill, plan.targetOrg.id);
      skillTargetIds.set(skill.id, copied.id);
      idMap.set(skill.id, copied.id);
      console.log(`skill ${copied.action}: ${skill.slug}`);
    }

    for (const subagent of plan.subagents) {
      const existing = await tx.subagentDefinition.findUnique({
        where: { orgId_name: { orgId: plan.targetOrg.id, name: subagent.name } },
        select: { id: true },
      });
      if (existing) {
        subagentTargetIds.set(subagent.id, existing.id);
        idMap.set(subagent.id, existing.id);
        console.log(`subagent reused: ${subagent.name}`);
        continue;
      }

      const created = await tx.subagentDefinition.create({
        data: {
          name: subagent.name,
          description: subagent.description,
          progressLabels: subagent.progressLabels as Prisma.InputJsonValue,
          systemPrompt: subagent.systemPrompt,
          paramName: subagent.paramName,
          paramDescription: subagent.paramDescription,
          tools: subagent.tools as Prisma.InputJsonValue,
          mcpInstanceMap: subagent.mcpInstanceMap === null ? Prisma.JsonNull : (subagent.mcpInstanceMap as Prisma.InputJsonValue),
          enabled: subagent.enabled,
          createdByUserId: plan.ownerUserId,
          orgId: plan.targetOrg.id,
        },
        select: { id: true },
      });
      subagentTargetIds.set(subagent.id, created.id);
      idMap.set(subagent.id, created.id);
      console.log(`subagent created: ${subagent.name}`);
    }

    for (const subagent of plan.subagents) {
      const targetId = subagentTargetIds.get(subagent.id);
      const targetMeta = plan.targetSubagentBySourceId.get(subagent.id);
      if (!targetId || targetMeta?.action === "reused") continue;

      const rewrittenTools = rewriteJsonIds(subagent.tools, idMap, `subagent:${subagent.name}.tools`, "$.tools", rewriteNotes).value;
      const rewrittenMcpMap = rewriteJsonIds(subagent.mcpInstanceMap, idMap, `subagent:${subagent.name}.mcpInstanceMap`, "$.mcpInstanceMap", rewriteNotes).value;
      await tx.subagentDefinition.update({
        where: { id: targetId },
        data: {
          tools: rewrittenTools ?? {},
          mcpInstanceMap: rewrittenMcpMap === null ? Prisma.JsonNull : rewrittenMcpMap,
        },
      });

      const targetSkillIds = subagent.skills
        .map((link) => skillTargetIds.get(link.skill.id))
        .filter((id): id is string => Boolean(id));
      if (targetSkillIds.length > 0) {
        await tx.subagentSkill.createMany({
          data: targetSkillIds.map((skillId) => ({ subagentDefinitionId: targetId, skillId })),
          skipDuplicates: true,
        });
      }
    }

    const rewrittenAgentConfig = rewriteJsonIds(plan.agent.config, idMap, `agent:${plan.agent.slug}.config`, "$.config", []).value ?? {};
    const data = {
      name: plan.agent.name,
      description: plan.agent.description,
      systemPrompt: plan.agent.systemPrompt,
      scope: plan.agent.scope,
      enabled: plan.agent.enabled,
      isDefault: false,
      color: plan.agent.color,
      modelId: plan.agent.modelId,
      config: rewrittenAgentConfig,
      kbScope: plan.agent.kbScope,
      ownerUserId: plan.ownerUserId,
      spacesAppId: null,
      spacesAppUserId: null,
      spacesAppToken: null,
      signingSecret: null,
      activePromptVersionId: null,
      activePromptVersion: null,
      promotedBy: null,
      promotedAt: null,
    } satisfies Prisma.AgentUncheckedUpdateInput;

    const targetAgent = plan.targetAgentExists
      ? await tx.agent.update({
          where: { orgId_slug: { orgId: plan.targetOrg.id, slug: plan.agent.slug } },
          data,
          select: { id: true },
        })
      : await tx.agent.create({
          data: {
            slug: plan.agent.slug,
            orgId: plan.targetOrg.id,
            ...data,
          },
          select: { id: true },
        });

    idMap.set(plan.agent.id, targetAgent.id);
    const finalAgentConfig = rewriteJsonIds(plan.agent.config, idMap, `agent:${plan.agent.slug}.config`, "$.config", rewriteNotes).value ?? {};
    await tx.agent.update({
      where: { id: targetAgent.id },
      data: { config: finalAgentConfig },
    });

    await Promise.all([
      tx.agentTool.deleteMany({ where: { agentId: targetAgent.id } }),
      tx.agentSkill.deleteMany({ where: { agentId: targetAgent.id } }),
    ]);
    if (plan.agent.tools.length > 0) {
      await tx.agentTool.createMany({
        data: plan.agent.tools.map((link) => ({
          agentId: targetAgent.id,
          toolId: link.toolId,
          permission: link.permission,
        })),
        skipDuplicates: true,
      });
    }
    const agentSkillIds = plan.agent.skills
      .map((link) => skillTargetIds.get(link.skill.id))
      .filter((id): id is string => Boolean(id));
    if (agentSkillIds.length > 0) {
      await tx.agentSkill.createMany({
        data: agentSkillIds.map((skillId) => ({ agentId: targetAgent.id, skillId })),
        skipDuplicates: true,
      });
    }

    return targetAgent.id;
  });

  console.log(`agent ${plan.targetAgentExists ? "overwritten" : "created"}: ${plan.agent.slug} (${result})`);
  return rewriteNotes;
}

function dryRunRewriteNotes(plan: GraphPlan): RewriteNote[] {
  const ids = new Set<string>([
    plan.sourceOrg.id,
    plan.agent.id,
    ...plan.skills.map((s) => s.id),
    ...plan.subagents.map((s) => s.id),
  ]);
  const notes = inspectIdRefs(plan.agent.config, ids, `agent:${plan.agent.slug}.config`, "$.config");
  for (const subagent of plan.subagents) {
    inspectIdRefs(subagent.tools, ids, `subagent:${subagent.name}.tools`, "$.tools", notes);
    inspectIdRefs(subagent.mcpInstanceMap, ids, `subagent:${subagent.name}.mcpInstanceMap`, "$.mcpInstanceMap", notes);
  }
  return notes;
}

function isDbUnreachable(err: unknown): boolean {
  const text = err instanceof Error ? `${err.name} ${err.message}` : String(err);
  return text.includes("P1001") || text.includes("ECONNREFUSED") || text.includes("Can't reach database server");
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  try {
    const plan = await buildGraph(args);
    printTree(plan);
    if (plan.targetAgentExists && !args.force) {
      console.log("Write guard: target agent exists; non-dry-run will refuse unless --force is provided.");
    }
    printRewriteNotes(dryRunRewriteNotes(plan));
    printSkipList(plan);

    if (args.dryRun) {
      console.log("Dry run: no DB writes performed.");
      return;
    }

    const notes = await executeCopy(plan, args);
    printRewriteNotes(notes);
    printSkipList(plan);
  } catch (err) {
    if (args.dryRun && isDbUnreachable(err)) {
      console.log("local DB not reachable — dry-run skipped");
      return;
    }
    throw err;
  } finally {
    await prisma.$disconnect();
  }
}

main().catch(async (err) => {
  console.error(err instanceof Error ? err.message : err);
  await prisma.$disconnect();
  process.exit(1);
});
