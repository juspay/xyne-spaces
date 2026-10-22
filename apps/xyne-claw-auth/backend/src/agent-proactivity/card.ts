/**
 * The generated routing card: what Spaces matches channel questions against to pick an
 * agent nobody tagged, unless the owner wrote their own text. xyne-claw writes it from
 * the agent's prompt and tools (routing-card.ts); this keeps it current.
 *
 * Regenerated when the prompt or tools change, and weekly once people have asked it new
 * things, so the daily sweep costs an LLM call per changed agent, not per agent.
 */

import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { prisma } from "../db.js";
import { CONFIG } from "../config.js";
import { createLogger } from "../logger.js";
import { getWorkspaceIdForUser } from "../lib/spaces-db.js";
import { publicChannels } from "./spaces-scope.js";
import { parseSlashCommand } from "../lib/parseSlashCommand.js";
import { readGeneratedCard, type GeneratedCard } from "./config.js";

const log = createLogger("agent-proactivity-card");

const TOOL_KEYS = ["direct", "custom", "subagents", "callableAgents"] as const;

/** Questions people tagged the agent with, as evidence of what it is asked in its own words. */
const ASKED_MAX = 30;
const ASKED_CHARS = 200;
const ASKED_DAYS = 90;
/** A card with newer questions waits this long before it is rewritten with them. */
const ASKED_REFRESH_MS = 7 * 24 * 3600_000;

interface CardSource {
  name: string;
  description: string;
  systemPrompt: string;
  tools: string[];
  /** Attached skills as "name: description", which say what it knows how to do. */
  skills: string[];
}

function cardSource(agent: {
  name: string;
  description: string;
  systemPrompt: string;
  config: unknown;
  skills: Array<{ skill: { name: string; description: string; enabled: boolean } }>;
}): CardSource {
  const tools = ((agent.config as { tools?: Record<string, unknown> } | null)?.tools ?? {}) as Record<string, unknown>;
  const names = TOOL_KEYS.flatMap((key) =>
    Array.isArray(tools[key]) ? (tools[key] as unknown[]).filter((t): t is string => typeof t === "string") : [],
  );
  return {
    name: agent.name,
    description: agent.description,
    systemPrompt: agent.systemPrompt,
    tools: [...new Set(names)].sort(),
    skills: agent.skills
      .filter(({ skill }) => skill.enabled)
      .map(({ skill }) => `${skill.name}: ${skill.description}`.trim())
      .sort(),
  };
}

const hashOf = (source: CardSource): string => createHash("sha256").update(JSON.stringify(source)).digest("hex");

/**
 * The question in a tagged run's task: `/goal <text>` and `/queue <text>` carry it, other
 * slash commands (`/stop`, `/status`…) ask nothing, and `/fast <text>` and the like are
 * the text after the command.
 */
function questionIn(task: string): string | null {
  const command = parseSlashCommand(task);
  if (command?.kind === "goalStart") return command.condition;
  if (command?.kind === "queueAdd") return command.message;
  if (command) return null;
  return task.trim().replace(/^\/\S+\s*/, "");
}

/** A question the agent was tagged with, and how its reply began: answered, or declined. */
type Asked = { question: string; reply?: string };

/**
 * What people asked the agent when they tagged it in a public channel and it answered,
 * newest first: the words routing has to match. Private channels and DMs stay out,
 * since the card is shown to anyone who can see the agent.
 */
async function askedOf(slug: string, orgId: string, botUserId: string): Promise<{ asked: Asked[]; newest: Date | null }> {
  const runs = await prisma.agentRun.findMany({
    where: {
      agentSlug: slug,
      orgId,
      triggerSource: "spaces",
      status: "completed",
      channelId: { not: null },
      OR: [{ rating: null }, { rating: { not: "down" } }],
      startedAt: { gte: new Date(Date.now() - ASKED_DAYS * 24 * 3600_000) },
    },
    orderBy: { startedAt: "desc" },
    take: ASKED_MAX * 5,
    select: { task: true, result: true, channelId: true, startedAt: true },
  });
  const workspaceId = runs.length > 0 ? await getWorkspaceIdForUser(botUserId, "proactivity") : null;
  const open = workspaceId
    ? await publicChannels({ userId: botUserId, workspaceId }, [...new Set(runs.map((run) => run.channelId!))])
    : new Set<string>();
  const asked = new Map<string, Asked>();
  let newest: Date | null = null;
  for (const run of runs) {
    if (asked.size >= ASKED_MAX) break;
    if (!open.has(run.channelId!)) continue;
    const text = (questionIn(run.task) ?? "").replace(/\s+/g, " ").trim().slice(0, ASKED_CHARS);
    const key = text.toLowerCase();
    if (!text || asked.has(key)) continue;
    const reply = (run.result ?? "").replace(/\s+/g, " ").trim().slice(0, ASKED_CHARS);
    asked.set(key, { question: text, ...(reply ? { reply } : {}) });
    newest ??= run.startedAt;
  }
  return { asked: [...asked.values()], newest };
}

/**
 * Regenerates the card when it is missing or stale, or always with `force`. Only for
 * agents with a Spaces bot: no bot, no channel to answer in.
 */
export async function refreshRoutingCard(agentId: string, opts: { force?: boolean } = {}): Promise<GeneratedCard | null> {
  const agent = await prisma.agent.findUnique({
    where: { id: agentId },
    select: {
      slug: true,
      orgId: true,
      name: true,
      description: true,
      systemPrompt: true,
      config: true,
      spacesAppUserId: true,
      skills: { select: { skill: { select: { name: true, description: true, enabled: true } } } },
    },
  });
  if (!agent?.spacesAppUserId) return null;

  const source = cardSource(agent);
  const sourceHash = hashOf(source);
  const current = readGeneratedCard(agent.config);
  const { asked, newest } = await askedOf(agent.slug, agent.orgId, agent.spacesAppUserId);
  const generatedAt = current ? new Date(current.generatedAt).getTime() : 0;
  const newQuestions = newest !== null && newest.getTime() > generatedAt && Date.now() - generatedAt > ASKED_REFRESH_MS;
  if (!opts.force && current?.sourceHash === sourceHash && !newQuestions) return current;

  const res = await fetch(`${CONFIG.xyneClawUrl}/generate-routing-card`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(CONFIG.xyneClawS2sKey ? { "x-s2s-key": CONFIG.xyneClawS2sKey } : {}),
    },
    body: JSON.stringify({ ...source, asked }),
    signal: AbortSignal.timeout(240_000),
  });
  const body = (await res.json().catch(() => null)) as { success?: boolean; data?: { card?: string }; error?: string } | null;
  const text = body?.data?.card?.trim();
  if (!res.ok || !text) throw new Error(body?.error ?? `generate-routing-card returned ${res.status}`);

  const card: GeneratedCard = { text, sourceHash, generatedAt: new Date().toISOString() };
  await saveCard(agentId, card);
  log.info(`[card] generated agent=${agent.slug} chars=${text.length} asked=${asked.length}`);
  return card;
}

/**
 * Writes only the card into the agent's config. The update applies only if the config is
 * still what was read, so an owner saving other settings meanwhile is never overwritten;
 * on a clash it reads again.
 */
async function saveCard(agentId: string, card: GeneratedCard): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const row = await prisma.agent.findUnique({ where: { id: agentId }, select: { config: true, updatedAt: true } });
    if (!row) return;
    const config = (row.config ?? {}) as Record<string, unknown>;
    const proactivity = (config["proactivity"] ?? {}) as Record<string, unknown>;
    const { count } = await prisma.agent.updateMany({
      where: { id: agentId, updatedAt: row.updatedAt },
      data: { config: { ...config, proactivity: { ...proactivity, generated: card } } as unknown as Prisma.InputJsonValue },
    });
    if (count === 1) return;
  }
  throw new Error("agent config kept changing while saving its routing card");
}

/** Every agent with a Spaces bot whose card is missing or stale. One at a time: it's an LLM call each. */
export async function refreshStaleRoutingCards(): Promise<{ checked: number; failed: number }> {
  const agents = await prisma.agent.findMany({
    where: { enabled: true, spacesAppUserId: { not: null } },
    select: { id: true, slug: true },
  });
  let failed = 0;
  for (const agent of agents) {
    await refreshRoutingCard(agent.id).catch((err: unknown) => {
      failed += 1;
      log.warn(`[card] refresh failed agent=${agent.slug}: ${err instanceof Error ? err.message : err}`);
    });
  }
  return { checked: agents.length, failed };
}
