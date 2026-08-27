/**
 * Agent memory files — deterministic, file-based memory (Memory v2).
 *
 * Generic across agents: scoped by (agentSlug, userId, name). Unlike the
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
 * userId NULL = a file shared across all users of that agent. Per-user rows are
 * unique via the DB constraint; shared (NULL) uniqueness is enforced here in
 * upsert (findFirst + create/update), since Postgres treats NULLs as distinct.
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

export interface AgentMemoryFileDTO {
  id: string;
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

function clampContent(content: string): string {
  return (content ?? "").slice(0, MAX_FILE_CHARS);
}

interface FileRow {
  id: string;
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

  await prisma.agentMemoryFile.createMany({
    data: missing.map((d) => ({
      agentSlug,
      userId,
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

export async function listFiles(agentSlug: string, userId: string | null): Promise<AgentMemoryFileDTO[]> {
  const rows = (await prisma.agentMemoryFile.findMany({
    where: { agentSlug, userId: userId ?? null },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
  })) as FileRow[];
  return rows.map(toDTO);
}

async function getFileRow(agentSlug: string, userId: string | null, name: string): Promise<FileRow | null> {
  return (await prisma.agentMemoryFile.findFirst({
    where: { agentSlug, userId: userId ?? null, name },
  })) as FileRow | null;
}

export async function getFile(agentSlug: string, userId: string | null, name: string): Promise<AgentMemoryFileDTO | null> {
  const row = await getFileRow(agentSlug, userId, name);
  return row ? toDTO(row) : null;
}

/** Create or replace a file's content (findFirst + create/update so a NULL
 *  userId is handled uniformly). Content is clamped to MAX_FILE_CHARS. */
export async function upsertFile(args: {
  agentSlug: string;
  userId: string | null;
  name: string;
  content: string;
  updatedBy: string;
  /** Only used on create. */
  loadInPrompt?: boolean;
  sortOrder?: number;
}): Promise<AgentMemoryFileDTO> {
  const { agentSlug, userId, name, updatedBy } = args;
  const content = clampContent(args.content);
  const existing = await getFileRow(agentSlug, userId, name);
  if (existing) {
    const updated = (await prisma.agentMemoryFile.update({
      where: { id: existing.id },
      data: { content, updatedBy },
    })) as FileRow;
    return toDTO(updated);
  }
  const created = (await prisma.agentMemoryFile.create({
    data: {
      agentSlug,
      userId,
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
  userId: string | null,
  name: string,
  load: boolean,
): Promise<AgentMemoryFileDTO> {
  const row = await getFileRow(agentSlug, userId, name);
  if (!row) throw new Error("not-found");

  if (load && !row.loadInPrompt) {
    const loadedCount = await prisma.agentMemoryFile.count({
      where: { agentSlug, userId: userId ?? null, loadInPrompt: true },
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

export async function deleteFile(agentSlug: string, userId: string | null, name: string): Promise<boolean> {
  const row = await getFileRow(agentSlug, userId, name);
  if (!row) return false;
  await prisma.agentMemoryFile.delete({ where: { id: row.id } });
  return true;
}

/** The files to inject into the agent's system prompt (loadInPrompt), ordered,
 *  capped at MAX_LOADED_FILES, each already ≤ MAX_FILE_CHARS. This is what claw
 *  fetches at run start. Skips empty files (nothing useful to inject). */
export async function getPromptFiles(agentSlug: string, userId: string | null): Promise<AgentMemoryFileDTO[]> {
  const rows = (await prisma.agentMemoryFile.findMany({
    where: { agentSlug, userId: userId ?? null, loadInPrompt: true },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    take: MAX_LOADED_FILES,
  })) as FileRow[];
  return rows.map(toDTO).filter((f) => f.content.trim().length > 0);
}
