#!/usr/bin/env tsx
/**
 * Mature Library Seed — populate claw-auth AI Library + Daily Brief so Spaces
 * AIScreen / Daily Brief look like ~1 year of use for a power user.
 *
 * Usage (from apps/xyne-claw-auth/backend):
 *   pnpm exec tsx --env-file=.env scripts/mature-library-seed.ts
 *   MATURE_LIBRARY_WIPE=1 pnpm exec tsx --env-file=.env scripts/mature-library-seed.ts
 *   SEED_USER_EMAIL=you@example.com SKILLS=18 AGENTS=8 pnpm exec tsx --env-file=.env scripts/mature-library-seed.ts
 *
 * Safety: refuses unless NODE_ENV=development or CLAW_ALLOW_SEED=1.
 * Wipe: MATURE_LIBRARY_WIPE=1 removes prior mature-library tagged rows.
 *
 * Tags: slug/name prefix `mature-` and/or description containing `[mature-library]`.
 */

import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { prisma } from "../src/db.js";
import {
  DAILY_BRIEF_KIND,
} from "../src/repositories/generatedContentRepository.js";
import {
  renderBriefMarkdown,
  type DailyBriefPayload,
} from "../src/services/dailyBrief.js";

const SEED_TAG = "[mature-library]";
const SEED_META = "mature-library" as const;

const envInt = (name: string, fallback: number): number => {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.floor(n);
};

const SKILLS = envInt("SKILLS", 18);
const AGENTS = envInt("AGENTS", 8);
const SUBAGENTS = envInt("SUBAGENTS", 8);
const BRIEF_DAYS = envInt("BRIEF_DAYS", 180);
const RUNS = envInt("RUNS", 40);

const DEFAULT_EMAIL = "devesh.prakash@juspay.in";
const SEED_USER_EMAIL = (process.env["SEED_USER_EMAIL"] ?? DEFAULT_EMAIL).trim();

const AGENT_COLORS = [
  "#6366f1",
  "#8b5cf6",
  "#ec4899",
  "#f97316",
  "#14b8a6",
  "#22c55e",
  "#0ea5e9",
  "#eab308",
];

const SKILL_TOPICS = [
  "incident triage",
  "PR review checklist",
  "customer escalation",
  "release notes",
  "on-call handoff",
  "API design review",
  "runbook drafting",
  "metrics deep-dive",
  "ticket prioritization",
  "meeting prep",
  "docs freshness audit",
  "security questionnaire",
  "data pipeline debug",
  "feature flag rollout",
  "support macro replies",
  "canvas summarization",
  "search relevance tuning",
  "agent prompt tuning",
];

const AGENT_ROLES = [
  "Release shepherd",
  "Incident commander",
  "Customer advocate",
  "Code reviewer",
  "Docs curator",
  "Metrics analyst",
  "Ticket triager",
  "Research assistant",
];

const SUBAGENT_NAMES = [
  "log grepper",
  "ticket linker",
  "calendar scout",
  "thread summarizer",
  "KB searcher",
  "diff reviewer",
  "status drafter",
  "follow-up nudger",
];

const BRIEF_HIGHLIGHTS = [
  "Platform standup thread needs a reply",
  "Two tickets moved to In Review overnight",
  "Call recording from yesterday has open action items",
  "Design review canvas was updated",
  "Customer Ops pinged about rollout timing",
  "Claw lab agent run completed with tool traces",
  "Bookmarked canvas on reliability metrics",
  "DM thread with squad lead awaiting decision",
];

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function assertSafeToRun(): void {
  const nodeEnv = process.env["NODE_ENV"] ?? "";
  const allowSeed = process.env["CLAW_ALLOW_SEED"] === "1";
  if (nodeEnv !== "development" && !allowSeed) {
    console.error(
      "Refusing to run: set NODE_ENV=development or CLAW_ALLOW_SEED=1.",
    );
    process.exit(1);
  }
}

function startOfUtcDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function addDays(d: Date, days: number): Date {
  const out = new Date(d);
  out.setUTCDate(out.getUTCDate() + days);
  return out;
}

function dateBucketFrom(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function pick<T>(items: T[], index: number): T {
  return items[index % items.length]!;
}

async function resolveUser(): Promise<{
  id: string;
  email: string;
  name: string;
  orgId: string;
}> {
  if (SEED_USER_EMAIL) {
    const byEmail = await prisma.user.findFirst({
      where: { email: SEED_USER_EMAIL },
      select: { id: true, email: true, name: true, orgId: true },
      orderBy: { createdAt: "desc" },
    });
    if (byEmail?.orgId) return byEmail;
    if (byEmail && !byEmail.orgId) {
      console.error(`User ${SEED_USER_EMAIL} exists but has no orgId.`);
      process.exit(1);
    }
    console.error(
      `No claw-auth user found for email ${SEED_USER_EMAIL}. Log into Spaces locally first (JIT creates the user).`,
    );
    process.exit(1);
  }

  const first = await prisma.user.findFirst({
    where: { orgId: { not: "" } },
    select: { id: true, email: true, name: true, orgId: true },
    orderBy: { createdAt: "asc" },
  });
  if (!first?.orgId) {
    console.error("No users with orgId found in claw-auth database.");
    process.exit(1);
  }
  return first;
}

async function wipeMatureLibrary(orgId: string, userId: string): Promise<void> {
  console.log("Wiping prior mature-library data…");

  const matureAgents = await prisma.agent.findMany({
    where: {
      orgId,
      OR: [
        { slug: { startsWith: "mature-" } },
        { description: { contains: SEED_TAG } },
      ],
    },
    select: { id: true, slug: true },
  });
  if (matureAgents.length > 0) {
    await prisma.agent.deleteMany({
      where: { id: { in: matureAgents.map((a) => a.id) } },
    });
    console.log(`  deleted ${matureAgents.length} agents`);
  }

  const matureSubagents = await prisma.subagentDefinition.findMany({
    where: {
      orgId,
      OR: [
        { name: { startsWith: "mature-" } },
        { description: { contains: SEED_TAG } },
      ],
    },
    select: { id: true },
  });
  if (matureSubagents.length > 0) {
    await prisma.subagentDefinition.deleteMany({
      where: { id: { in: matureSubagents.map((s) => s.id) } },
    });
    console.log(`  deleted ${matureSubagents.length} subagents`);
  }

  const matureSkills = await prisma.skill.findMany({
    where: {
      orgId,
      OR: [
        { slug: { startsWith: "mature-" } },
        { description: { contains: SEED_TAG } },
      ],
    },
    select: { id: true },
  });
  if (matureSkills.length > 0) {
    await prisma.skill.deleteMany({
      where: { id: { in: matureSkills.map((s) => s.id) } },
    });
    console.log(`  deleted ${matureSkills.length} skills`);
  }

  const briefDeletes = await prisma.generatedContent.deleteMany({
    where: {
      userId,
      OR: [
        { content: { contains: SEED_TAG } },
        { data: { path: ["seed"], equals: SEED_META } },
      ],
    },
  });
  if (briefDeletes.count > 0) {
    console.log(`  deleted ${briefDeletes.count} generated-content rows`);
  }

  const runDeletes = await prisma.agentRun.deleteMany({
    where: {
      userId,
      orgId,
      agentSlug: { startsWith: "mature-" },
    },
  });
  if (runDeletes.count > 0) {
    console.log(`  deleted ${runDeletes.count} agent runs`);
  }
}

function skillSlug(i: number): string {
  return `mature-skill-${pad2(i)}`;
}

function agentSlug(i: number): string {
  return `mature-agent-${pad2(i)}`;
}

function subagentName(i: number): string {
  return `mature-${pick(SUBAGENT_NAMES, i - 1).replace(/\s+/g, "-")}-${pad2(i)}`;
}

function buildSkillContent(topic: string, index: number): string {
  return `# ${topic}

${SEED_TAG}

Use this skill when ${topic} comes up in Spaces threads or tickets.

## Steps
1. Gather context from the last 48h of related channels.
2. Summarize blockers and owners in bullet form.
3. Propose the next concrete action with a due hint.

## Notes
- Prefer links to canvases and tickets over long prose.
- Keep outputs under 12 bullets unless asked otherwise.
- Seed index: ${index}.
`;
}

function buildBriefPayload(date: string, dayIndex: number): DailyBriefPayload {
  const h = (offset: number) =>
    pick(BRIEF_HIGHLIGHTS, dayIndex + offset);
  return {
    generated_for: "you",
    date,
    what_needs_you: [
      `${h(0)} — reply before noon.`,
      `${h(1)} — skim the overnight diff.`,
    ],
    overdue: dayIndex % 5 === 0 ? [`${h(2)} slipped from last week.`] : [],
    waiting_on_others: [
      `${h(3)} — waiting on platform review.`,
    ],
    assigned_to_you: [
      `${h(4)} assigned yesterday.`,
      `${h(5)} tagged you in #engineering.`,
    ],
    todays_schedule: [
      `${h(6)} at 10:30 IST.`,
      `${h(7)} office hours block 15:00 IST.`,
    ],
  };
}

async function seedSkills(
  orgId: string,
  ownerUserId: string,
): Promise<{ created: number; reused: number; ids: string[] }> {
  let created = 0;
  let reused = 0;
  const ids: string[] = [];

  for (let i = 1; i <= SKILLS; i++) {
    const slug = skillSlug(i);
    const topic = pick(SKILL_TOPICS, i - 1);
    const scope = i <= 4 ? "global" : "personal";
    const existing = await prisma.skill.findUnique({
      where: { orgId_slug: { orgId, slug } },
      select: { id: true },
    });
    if (existing) {
      ids.push(existing.id);
      reused++;
      continue;
    }

    const row = await prisma.skill.create({
      data: {
        orgId,
        slug,
        name: `${topic} (${SEED_TAG})`,
        label: topic,
        description: `${SEED_TAG} Personal library skill for ${topic}.`,
        content: buildSkillContent(topic, i),
        source: scope === "global" ? "seeded" : "user",
        scope,
        ownerUserId: scope === "personal" ? ownerUserId : null,
        enabled: true,
      },
      select: { id: true },
    });
    ids.push(row.id);
    created++;
  }

  return { created, reused, ids };
}

async function seedAgents(
  orgId: string,
  ownerUserId: string,
): Promise<{ created: number; reused: number; ids: string[]; slugs: string[] }> {
  let created = 0;
  let reused = 0;
  const ids: string[] = [];
  const slugs: string[] = [];

  for (let i = 1; i <= AGENTS; i++) {
    const slug = agentSlug(i);
    const role = pick(AGENT_ROLES, i - 1);
    slugs.push(slug);

    const existing = await prisma.agent.findUnique({
      where: { orgId_slug: { orgId, slug } },
      select: { id: true },
    });
    if (existing) {
      ids.push(existing.id);
      reused++;
      continue;
    }

    const row = await prisma.agent.create({
      data: {
        orgId,
        slug,
        name: `${role} ${SEED_TAG}`,
        description: `${SEED_TAG} Personal agent for ${role.toLowerCase()} workflows.`,
        systemPrompt: `You are a focused ${role.toLowerCase()} assistant. Be concise, cite Spaces threads, and prefer actionable next steps. ${SEED_TAG}`,
        scope: "personal",
        ownerUserId,
        enabled: true,
        color: pick(AGENT_COLORS, i - 1),
      },
      select: { id: true },
    });
    ids.push(row.id);
    created++;
  }

  return { created, reused, ids, slugs };
}

async function seedSubagents(
  orgId: string,
  createdByUserId: string,
): Promise<{ created: number; reused: number; ids: string[] }> {
  let created = 0;
  let reused = 0;
  const ids: string[] = [];

  for (let i = 1; i <= SUBAGENTS; i++) {
    const name = subagentName(i);
    const label = pick(SUBAGENT_NAMES, i - 1);

    const existing = await prisma.subagentDefinition.findUnique({
      where: { orgId_name: { orgId, name } },
      select: { id: true },
    });
    if (existing) {
      ids.push(existing.id);
      reused++;
      continue;
    }

    const tools: Prisma.InputJsonValue =
      i % 3 === 0
        ? { allow: ["read"], deny: [] }
        : i % 3 === 1
          ? { allow: ["read", "search"], deny: ["write"] }
          : {};

    const row = await prisma.subagentDefinition.create({
      data: {
        orgId,
        name,
        description: `${SEED_TAG} Subagent for ${label}.`,
        progressLabels: [`Scanning for ${label}…`, "Drafting answer…", "Done"],
        systemPrompt: `You are a ${label} subagent. Return short, structured answers. ${SEED_TAG}`,
        paramName: "question",
        paramDescription: `What should the ${label} look into?`,
        tools,
        enabled: true,
        createdByUserId,
      },
      select: { id: true },
    });
    ids.push(row.id);
    created++;
  }

  return { created, reused, ids };
}

async function linkAgentSkills(
  agentIds: string[],
  skillIds: string[],
): Promise<number> {
  let linked = 0;
  for (let a = 0; a < agentIds.length; a++) {
    const agentId = agentIds[a]!;
    const count = 2 + (a % 3);
    const chosen = new Set<number>();
    while (chosen.size < count) {
      chosen.add((a * 3 + chosen.size * 5) % skillIds.length);
    }
    for (const idx of Array.from(chosen)) {
      const skillId = skillIds[idx]!;
      await prisma.agentSkill.upsert({
        where: { agentId_skillId: { agentId, skillId } },
        create: { agentId, skillId },
        update: {},
      });
      linked++;
    }
  }
  return linked;
}

async function linkSubagentSkills(
  subagentIds: string[],
  skillIds: string[],
): Promise<number> {
  let linked = 0;
  for (let s = 0; s < subagentIds.length; s++) {
    const subagentDefinitionId = subagentIds[s]!;
    const skillId = skillIds[s % skillIds.length]!;
    const secondSkillId = skillIds[(s + 7) % skillIds.length]!;
    for (const sid of [skillId, secondSkillId]) {
      await prisma.subagentSkill.upsert({
        where: {
          subagentDefinitionId_skillId: { subagentDefinitionId, skillId: sid },
        },
        create: { subagentDefinitionId, skillId: sid },
        update: {},
      });
      linked++;
    }
  }
  return linked;
}

async function seedDailyBriefs(
  userId: string,
  orgId: string,
  agentSlug: string,
): Promise<{ created: number; updated: number; skipped: number }> {
  let created = 0;
  let updated = 0;
  let skipped = 0;
  const today = startOfUtcDay(new Date());

  for (let day = 0; day < BRIEF_DAYS; day++) {
    const bucketDate = addDays(today, -(BRIEF_DAYS - 1 - day));
    const dateBucket = dateBucketFrom(bucketDate);
    const payload = buildBriefPayload(dateBucket, day);
    const content = `${renderBriefMarkdown(payload)}\n\n<!-- ${SEED_TAG} -->`;
    const data: Prisma.InputJsonValue = {
      ...payload,
      seed: SEED_META,
      highlights: [
        pick(BRIEF_HIGHLIGHTS, day),
        pick(BRIEF_HIGHLIGHTS, day + 3),
        pick(BRIEF_HIGHLIGHTS, day + 5),
      ],
    };
    const generatedAt = new Date(bucketDate);
    generatedAt.setUTCHours(6, 30, 0, 0);

    const existing = await prisma.generatedContent.findUnique({
      where: {
        userId_kind_dateBucket: {
          userId,
          kind: DAILY_BRIEF_KIND,
          dateBucket,
        },
      },
      select: { id: true, data: true, content: true },
    });

    if (existing) {
      const existingSeed =
        existing.data &&
        typeof existing.data === "object" &&
        !Array.isArray(existing.data)
          ? (existing.data as { seed?: string }).seed
          : undefined;
      const isOurs =
        existingSeed === SEED_META || existing.content.includes(SEED_TAG);
      if (!isOurs) {
        skipped++;
        continue;
      }
    }

    const result = await prisma.generatedContent.upsert({
      where: {
        userId_kind_dateBucket: {
          userId,
          kind: DAILY_BRIEF_KIND,
          dateBucket,
        },
      },
      create: {
        userId,
        orgId,
        kind: DAILY_BRIEF_KIND,
        dateBucket,
        agentSlug,
        content,
        data,
        status: "ready",
        generatedAt,
      },
      update: {
        content,
        data,
        status: "ready",
        agentSlug,
        generatedAt,
      },
    });

    if (existing) updated++;
    else if (result) created++;
  }

  return { created, updated, skipped };
}

async function seedAgentRuns(
  userId: string,
  orgId: string,
  agentSlugs: string[],
): Promise<{ created: number; skipped: number }> {
  if (RUNS <= 0 || agentSlugs.length === 0) {
    return { created: 0, skipped: 0 };
  }

  let created = 0;
  let skipped = 0;
  const today = startOfUtcDay(new Date());
  const spanDays = Math.max(BRIEF_DAYS, 120);

  for (let i = 0; i < RUNS; i++) {
    const sessionId = `mature-library-${userId}-${i}-${randomUUID()}`;
    const existing = await prisma.agentRun.findUnique({
      where: { sessionId },
      select: { id: true },
    });
    if (existing) {
      skipped++;
      continue;
    }

    const startedAt = addDays(today, -Math.floor((i * spanDays) / RUNS));
    startedAt.setUTCHours(9 + (i % 8), (i * 11) % 60, 0, 0);
    const completedAt = new Date(startedAt);
    completedAt.setUTCMinutes(completedAt.getUTCMinutes() + 3 + (i % 12));

    const agentSlug = pick(agentSlugs, i);
    const status = i % 11 === 0 ? "failed" : "completed";

    await prisma.agentRun.create({
      data: {
        sessionId,
        userId,
        orgId,
        agentSlug,
        provider: "spaces",
        model: "private-large",
        triggerSource: i % 4 === 0 ? "scheduled" : "chat",
        status,
        task: `${SEED_TAG} Sample run ${i + 1} for ${agentSlug}`,
        result:
          status === "completed"
            ? "Summarized open threads and proposed next actions."
            : null,
        error: status === "failed" ? "Transient provider timeout (seed)." : null,
        toolsUsed: i % 3 === 0 ? ["read", "search"] : ["read"],
        tokensIn: 1200 + i * 40,
        tokensOut: 280 + i * 12,
        totalMs: 18_000 + i * 500,
        startedAt,
        completedAt: status === "completed" ? completedAt : null,
      },
    });
    created++;
  }

  return { created, skipped };
}

async function main(): Promise<void> {
  assertSafeToRun();

  const wipe = process.env["MATURE_LIBRARY_WIPE"] === "1";
  const user = await resolveUser();

  console.log(`Seeding mature library for ${user.name} <${user.email}> (org=${user.orgId})`);
  if (wipe) {
    await wipeMatureLibrary(user.orgId, user.id);
  }

  const skills = await seedSkills(user.orgId, user.id);
  const agents = await seedAgents(user.orgId, user.id);
  const subagents = await seedSubagents(user.orgId, user.id);
  const agentSkillLinks = await linkAgentSkills(agents.ids, skills.ids);
  const subagentSkillLinks = await linkSubagentSkills(subagents.ids, skills.ids);
  const briefAgentSlug = agents.slugs[0] ?? "ask-ai";
  const briefs = await seedDailyBriefs(user.id, user.orgId, briefAgentSlug);
  const runs = await seedAgentRuns(user.id, user.orgId, agents.slugs);

  const [
    skillCount,
    agentCount,
    subagentCount,
    briefCount,
    runCount,
  ] = await Promise.all([
    prisma.skill.count({
      where: { orgId: user.orgId, slug: { startsWith: "mature-" } },
    }),
    prisma.agent.count({
      where: { orgId: user.orgId, slug: { startsWith: "mature-" } },
    }),
    prisma.subagentDefinition.count({
      where: { orgId: user.orgId, name: { startsWith: "mature-" } },
    }),
    prisma.generatedContent.count({
      where: {
        userId: user.id,
        kind: DAILY_BRIEF_KIND,
        data: { path: ["seed"], equals: SEED_META },
      },
    }),
    prisma.agentRun.count({
      where: {
        userId: user.id,
        orgId: user.orgId,
        agentSlug: { startsWith: "mature-" },
      },
    }),
  ]);

  console.log("\n── Summary ──");
  console.log(`User:        ${user.email}`);
  console.log(`Skills:      ${skillCount} total (${skills.created} created, ${skills.reused} reused)`);
  console.log(`Agents:      ${agentCount} total (${agents.created} created, ${agents.reused} reused)`);
  console.log(`Subagents:   ${subagentCount} total (${subagents.created} created, ${subagents.reused} reused)`);
  console.log(`AgentSkill:  ${agentSkillLinks} links`);
  console.log(`SubagentSkill: ${subagentSkillLinks} links`);
  console.log(
    `Daily briefs: ${briefCount} total (${briefs.created} created, ${briefs.updated} updated, ${briefs.skipped} skipped)`,
  );
  console.log(`Agent runs:  ${runCount} total (${runs.created} created, ${runs.skipped} skipped)`);
  console.log("\nDone.");
}

main()
  .catch((err) => {
    console.error("mature-library-seed failed:", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
