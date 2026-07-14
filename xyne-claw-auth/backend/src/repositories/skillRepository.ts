import type { Prisma } from "@prisma/client";
import { prisma } from "../db.js";
import { createLogger } from "../logger.js";

const log = createLogger("skill-repository");

/**
 * Normalize and validate a path destined for `SkillFile.relativePath`.
 * Throws on absolute paths, `..` traversal, or empty input. Returns a
 * normalized POSIX path (forward slashes, no leading/trailing slash, no
 * `.` segments).
 */
export function normalizeSkillRelativePath(input: string): string {
  if (typeof input !== "string") throw new Error("relativePath must be a string");
  const trimmed = input.trim();
  if (!trimmed) throw new Error("relativePath cannot be empty");
  // Reject Windows-style drive letters as well as POSIX absolute paths.
  if (/^([a-zA-Z]:[\\/])|^[\\/]/.test(trimmed)) {
    throw new Error("relativePath must not be absolute");
  }
  const segs = trimmed.replace(/\\/g, "/").split("/").filter((s) => s.length > 0 && s !== ".");
  if (segs.some((s) => s === "..")) throw new Error("relativePath must not contain '..'");
  if (segs.length === 0) throw new Error("relativePath cannot be empty after normalization");
  if (segs.some((s) => s.length > 255)) throw new Error("relativePath segment too long");
  return segs.join("/");
}

export interface SkillFileInput {
  relativePath: string;
  content: string;
  contentType?: string | undefined;
}

/**
 * Field-scoped owner projection. We deliberately select ONLY identity
 * fields (id/name/email) rather than `include: { owner: true }`: the User
 * row carries private Digital-Twin columns and routes/skills.ts forwards
 * rows to clients without a sanitizer, so a broad include would leak them.
 */
const OWNER_SELECT = { select: { id: true, name: true, email: true } } as const;

export const skillRepository = {
  /**
   * Same admin-bypass rule as agentRepository.listVisible. Admins see ALL
   * skills, including private ones owned by other users — necessary for
   * operators auditing skill libraries workspace-wide.
   */
  listVisible: (opts: { userId?: string; isAdmin?: boolean; orgId?: string } = {}) => {
    const base: Prisma.SkillWhereInput = opts.isAdmin
      ? {}
      : opts.userId
        ? { OR: [{ scope: "global" }, { ownerUserId: opts.userId }] }
        : { scope: "global" };
    // Phase-2: AND the caller's org when provided (see agentRepository.listVisible).
    const where: Prisma.SkillWhereInput = opts.orgId ? { AND: [{ orgId: opts.orgId }, base] } : base;
    return prisma.skill.findMany({
      where,
      orderBy: { name: "asc" },
      include: { owner: OWNER_SELECT },
    });
  },

  findAll: (source?: string) =>
    prisma.skill.findMany({
      ...(source ? { where: { source } } : {}),
      orderBy: { name: "asc" },
    }),

  findBySlug: (slug: string, orgId?: string | null) => {
    if (!orgId) {
      log.error("[skillRepository.findBySlug] missing orgId; refusing global slug lookup", { slug });
      return Promise.resolve(null);
    }
    return prisma.skill.findUnique({
      where: { orgId_slug: { orgId, slug } },
      include: { owner: OWNER_SELECT },
    });
  },

  findById: (id: string) =>
    prisma.skill.findUnique({ where: { id } }),

  findByIds: (ids: string[]) =>
    ids.length === 0 ? Promise.resolve([]) : prisma.skill.findMany({ where: { id: { in: ids } } }),

  create: (data: Prisma.SkillCreateInput) =>
    prisma.skill.create({ data }),

  update: (slug: string, orgId: string, data: Prisma.SkillUpdateInput) =>
    prisma.skill.update({ where: { orgId_slug: { orgId, slug } }, data }),

  delete: (slug: string, orgId: string) =>
    prisma.skill.delete({ where: { orgId_slug: { orgId, slug } } }),

  upsertBySlug: (slug: string, orgId: string, create: Prisma.SkillCreateInput, update: Prisma.SkillUpdateInput) =>
    prisma.skill.upsert({ where: { orgId_slug: { orgId, slug } }, create, update }),

  // ── File-bundle helpers (SkillFile rows) ────────────────────────────

  listFiles: (skillId: string) =>
    prisma.skillFile.findMany({
      where: { skillId },
      orderBy: { relativePath: "asc" },
    }),

  /**
   * Replace the entire file set for a skill atomically. Empty `files` clears
   * all extra files (the SKILL.md in Skill.content is unaffected).
   */
  replaceFiles: async (skillId: string, files: SkillFileInput[]): Promise<void> => {
    const rows = files.map((f) => {
      const relativePath = normalizeSkillRelativePath(f.relativePath);
      // Forbid clashing with the auto-materialized SKILL.md — that comes
      // from Skill.content and writing a separate row for it would create
      // two writers for the same path.
      if (relativePath === "SKILL.md") {
        throw new Error('relativePath "SKILL.md" is reserved (use Skill.content)');
      }
      return {
        skillId,
        relativePath,
        content: f.content,
        contentType: f.contentType ?? null,
        sizeBytes: Buffer.byteLength(f.content, "utf8"),
      };
    });

    await prisma.$transaction([
      prisma.skillFile.deleteMany({ where: { skillId } }),
      ...(rows.length > 0
        ? [prisma.skillFile.createMany({ data: rows, skipDuplicates: false })]
        : []),
    ]);
  },
};
