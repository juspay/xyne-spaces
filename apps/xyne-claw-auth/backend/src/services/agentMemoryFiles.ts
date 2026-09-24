/**
 * Agent memory files — deterministic, file-based memory (Memory v2).
 *
 * Generic across agents: scoped by (orgId, agentSlug, userId, name). Unlike the
 * Hindsight-backed candidate memories (semantic recall), these are NAMED
 * documents fetched by key. The Digital Twin uses them for an always-loaded
 * persona (soul.md, people.md, projects.md, …) so it works well with zero tool
 * calls; any other agent can adopt the same layer by passing its own slug.
 *
 * Invariants (enforced here):
 *   - each file's content is capped at MAX_FILE_CHARS (20k) so injection can't
 *     blow the context window;
 *   - at most MAX_LOADED_FILES (3) files per (agent, user) may be loadInPrompt.
 *
 * Every file names a tenant. A user id implies one, so per-user call sites pass
 * the id alone; a shared file (`{ orgId }`) has no owner to inherit from and
 * must say which org it belongs to — see FileOwner.
 *
 * Per-user rows are unique via the DB constraint; shared uniqueness is enforced
 * here in upsert (findFirst + create/update), since Postgres treats NULLs as
 * distinct and every shared row has a NULL userId.
 */

import type { UserMemorySubsystem } from "xyne-claw-shared";
import { prisma } from "../db.js";
import { createLogger, createTraceId } from "../logger.js";

const logger = createLogger("agent-memory-files", createTraceId());

/** Per-file hard cap. Keeps 3 loaded files ≤ 60k chars ≈ 15k tokens of
 *  always-on system-prompt budget. */
export const MAX_FILE_CHARS = 20_000;
/** Max files injected into the system prompt per (agent, user). */
export const MAX_LOADED_FILES = 3;

/** The Digital Twin's agent slug (matches DIGITAL_TWIN_SLUG in xyne-claw). */
export const TWIN_AGENT_SLUG = "digital-twin";

/**
 * Who a memory file belongs to.
 *
 * A user id is enough by itself: a user belongs to exactly one org, so the
 * tenant travels with them and reads never have to name it. A file shared
 * across an agent's users has no owner to inherit from, and agent slugs repeat
 * across orgs by design, so that case has to state the org.
 *
 * A union rather than a nullable id on purpose — there is no way to address a
 * shared file without answering whose it is, and the compiler asks at every
 * call site instead of the question being forgotten at one of them.
 */
export type FileOwner = string | { orgId: string };

export interface AgentMemoryFileDTO {
  id: string;
  orgId: string;
  agentSlug: string;
  userId: string | null;
  name: string;
  content: string;
  loadInPrompt: boolean;
  sortOrder: number;
  updatedBy: string | null;
  updatedAt: string;
}

/** Thrown when a loadInPrompt toggle would exceed MAX_LOADED_FILES. Routes map
 *  this to a 400 with a friendly message. */
export class MaxLoadedFilesError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MaxLoadedFilesError";
  }
}

/** A seed file every twin user starts with — same default structure for all,
 *  so the soul synthesizer has stable sections to compile into. `subsystems`
 *  maps approved-fact clusters → this file (used by the Phase-4 synthesizer). */
export interface DefaultFileSpec {
  name: string;
  loadInPrompt: boolean;
  sortOrder: number;
  description: string;
  subsystems: UserMemorySubsystem[];
  seed: string;
}

/** Default Digital Twin file structure. First three load into the prompt by
 *  default (the max); the rest are opt-in so the user can swap what's loaded. */
export const DEFAULT_TWIN_FILES: readonly DefaultFileSpec[] = [
  {
    name: "soul.md",
    loadInPrompt: true,
    sortOrder: 0,
    description: "Your core persona — how you sound, who you are, and when you engage. Always follow this.",
    subsystems: ["style", "context", "triage"],
    seed: [
      "# Soul",
      "",
      "_Your Digital Twin's core persona — how you sound and who you are. Compiled from the memories you approve; edit anytime._",
      "",
      "## Voice",
      "_(how you write: length, openers, sign-offs, tone, punctuation — from your approved style memories)_",
      "",
      "## Identity",
      "_(role, team, how you show up)_",
      "",
      "## Engagement",
      "_(when you respond, when you stay silent, and which conversations you prioritize — from approved triage memories)_",
    ].join("\n"),
  },
  {
    name: "people.md",
    loadInPrompt: true,
    sortOrder: 1,
    description: "Who you work with and how your tone shifts per person.",
    subsystems: ["relationships"],
    seed: [
      "# People",
      "",
      "_Who you work with and how your tone shifts per person. Compiled from your approved relationship memories._",
    ].join("\n"),
  },
  {
    name: "projects.md",
    loadInPrompt: true,
    sortOrder: 2,
    description: "What you're actively working on right now.",
    subsystems: ["projects"],
    seed: [
      "# Projects",
      "",
      "_What you're actively working on right now. Compiled from your approved project memories._",
    ].join("\n"),
  },
  {
    name: "playbook.md",
    loadInPrompt: false,
    sortOrder: 3,
    description: "How you work — tools, conventions, and the judgment calls you make.",
    subsystems: ["preferences", "decisions"],
    seed: [
      "# Playbook",
      "",
      "_How you work — tools, conventions, and judgment calls. Compiled from your approved preference & decision memories._",
    ].join("\n"),
  },
  {
    name: "expertise.md",
    loadInPrompt: false,
    sortOrder: 4,
    description: "Domains, systems, and tools you know deeply.",
    subsystems: ["expertise"],
    seed: [
      "# Expertise",
      "",
      "_Domains, systems, and tools you know deeply. Compiled from your approved expertise memories._",
    ].join("\n"),
  },
];

function isUserOwned(owner: FileOwner): owner is string {
  return typeof owner === "string";
}

/** Row selector for an owner. A user id identifies its rows on its own; shared
 *  rows are identified by the org, which is why the column exists. */
function ownerWhere(owner: FileOwner): { userId: string } | { userId: null; orgId: string } {
  return isUserOwned(owner) ? { userId: owner } : { userId: null, orgId: owner.orgId };
}

/** Tenant + owner for a new row. The user lookup happens on create only — reads
 *  are keyed on the user id itself, so the hot path never pays for it. */
async function newRowScope(owner: FileOwner): Promise<{ orgId: string; userId: string | null }> {
  if (!isUserOwned(owner)) return { orgId: owner.orgId, userId: null };
  const user = await prisma.user.findUnique({ where: { id: owner }, select: { orgId: true } });
  if (!user) throw new Error(`cannot create a memory file for unknown user ${owner}`);
  return { orgId: user.orgId, userId: owner };
}

function clampContent(content: string): string {
  return (content ?? "").slice(0, MAX_FILE_CHARS);
}

interface FileRow {
  id: string;
  orgId: string;
  agentSlug: string;
  userId: string | null;
  name: string;
  content: string;
  loadInPrompt: boolean;
  sortOrder: number;
  updatedBy: string | null;
  updatedAt: Date;
}

function toDTO(row: FileRow): AgentMemoryFileDTO {
  return {
    id: row.id,
    orgId: row.orgId,
    agentSlug: row.agentSlug,
    userId: row.userId,
    name: row.name,
    content: row.content,
    loadInPrompt: row.loadInPrompt,
    sortOrder: row.sortOrder,
    updatedBy: row.updatedBy,
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** Seed any missing default files for (agent, user). Idempotent — existing
 *  files (even edited ones) are left untouched. Called on twin enable. */
export async function ensureDefaultFiles(
  agentSlug: string,
  userId: string,
  defaults: readonly DefaultFileSpec[] = DEFAULT_TWIN_FILES,
): Promise<void> {
  const existing = await prisma.agentMemoryFile.findMany({
    where: { agentSlug, userId },
    select: { name: true },
  });
  const have = new Set(existing.map((e) => e.name));
  const missing = defaults.filter((d) => !have.has(d.name));
  if (missing.length === 0) return;

  const scope = await newRowScope(userId);
  await prisma.agentMemoryFile.createMany({
    data: missing.map((d) => ({
      ...scope,
      agentSlug,
      name: d.name,
      content: clampContent(d.seed),
      loadInPrompt: d.loadInPrompt,
      sortOrder: d.sortOrder,
      updatedBy: "seed",
    })),
    skipDuplicates: true,
  });
  logger.info("[agent-memory-files] seeded defaults", { agentSlug, userId, seeded: missing.map((m) => m.name) });
}

export async function listFiles(agentSlug: string, owner: FileOwner): Promise<AgentMemoryFileDTO[]> {
  const rows = (await prisma.agentMemoryFile.findMany({
    where: { agentSlug, ...ownerWhere(owner) },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
  })) as FileRow[];
  return rows.map(toDTO);
}

async function getFileRow(agentSlug: string, owner: FileOwner, name: string): Promise<FileRow | null> {
  return (await prisma.agentMemoryFile.findFirst({
    where: { agentSlug, ...ownerWhere(owner), name },
  })) as FileRow | null;
}

export async function getFile(agentSlug: string, owner: FileOwner, name: string): Promise<AgentMemoryFileDTO | null> {
  const row = await getFileRow(agentSlug, owner, name);
  return row ? toDTO(row) : null;
}

/** Create or replace a file's content (findFirst + create/update so a shared
 *  file's NULL userId is handled uniformly). Clamped to MAX_FILE_CHARS. */
export async function upsertFile(args: {
  agentSlug: string;
  owner: FileOwner;
  name: string;
  content: string;
  updatedBy: string;
  /** Only used on create. */
  loadInPrompt?: boolean;
  sortOrder?: number;
}): Promise<AgentMemoryFileDTO> {
  const { agentSlug, owner, name, updatedBy } = args;
  const content = clampContent(args.content);
  const existing = await getFileRow(agentSlug, owner, name);
  if (existing) {
    const updated = (await prisma.agentMemoryFile.update({
      where: { id: existing.id },
      data: { content, updatedBy },
    })) as FileRow;
    return toDTO(updated);
  }
  const created = (await prisma.agentMemoryFile.create({
    data: {
      ...(await newRowScope(owner)),
      agentSlug,
      name,
      content,
      updatedBy,
      loadInPrompt: args.loadInPrompt ?? false,
      sortOrder: args.sortOrder ?? 100,
    },
  })) as FileRow;
  return toDTO(created);
}

/** Toggle whether a file is injected into the prompt. Enforces MAX_LOADED_FILES. */
export async function setLoadInPrompt(
  agentSlug: string,
  owner: FileOwner,
  name: string,
  load: boolean,
): Promise<AgentMemoryFileDTO> {
  const row = await getFileRow(agentSlug, owner, name);
  if (!row) throw new Error("not-found");

  if (load && !row.loadInPrompt) {
    const loadedCount = await prisma.agentMemoryFile.count({
      where: { agentSlug, ...ownerWhere(owner), loadInPrompt: true },
    });
    if (loadedCount >= MAX_LOADED_FILES) {
      throw new MaxLoadedFilesError(
        `At most ${MAX_LOADED_FILES} memory files can be loaded into the prompt at once. Unload one first.`,
      );
    }
  }

  const updated = (await prisma.agentMemoryFile.update({
    where: { id: row.id },
    data: { loadInPrompt: load },
  })) as FileRow;
  return toDTO(updated);
}

export async function deleteFile(agentSlug: string, owner: FileOwner, name: string): Promise<boolean> {
  const row = await getFileRow(agentSlug, owner, name);
  if (!row) return false;
  await prisma.agentMemoryFile.delete({ where: { id: row.id } });
  return true;
}

/** The files to inject into the agent's system prompt (loadInPrompt), ordered,
 *  capped at MAX_LOADED_FILES, each already ≤ MAX_FILE_CHARS. This is what claw
 *  fetches at run start. Skips empty files (nothing useful to inject). */
export async function getPromptFiles(agentSlug: string, owner: FileOwner): Promise<AgentMemoryFileDTO[]> {
  const rows = (await prisma.agentMemoryFile.findMany({
    where: { agentSlug, ...ownerWhere(owner), loadInPrompt: true },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    take: MAX_LOADED_FILES,
  })) as FileRow[];
  return rows.map(toDTO).filter((f) => f.content.trim().length > 0);
}
