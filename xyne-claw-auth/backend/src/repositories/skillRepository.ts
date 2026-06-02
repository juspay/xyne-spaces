import type { Prisma } from "@prisma/client";
import { prisma } from "../db.js";

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

export const skillRepository = {
  listVisible: (userId?: string) =>
    prisma.skill.findMany({
      where: userId
        ? { OR: [{ scope: "global" }, { ownerUserId: userId }] }
        : { scope: "global" },
      orderBy: { name: "asc" },
    }),

  findAll: (source?: string) =>
    prisma.skill.findMany({
      ...(source ? { where: { source } } : {}),
      orderBy: { name: "asc" },
    }),

  findBySlug: (slug: string) =>
    prisma.skill.findUnique({ where: { slug } }),

  findById: (id: string) =>
    prisma.skill.findUnique({ where: { id } }),

  findByIds: (ids: string[]) =>
    ids.length === 0 ? Promise.resolve([]) : prisma.skill.findMany({ where: { id: { in: ids } } }),

  create: (data: Prisma.SkillCreateInput) =>
    prisma.skill.create({ data }),

  update: (slug: string, data: Prisma.SkillUpdateInput) =>
    prisma.skill.update({ where: { slug }, data }),

  delete: (slug: string) =>
    prisma.skill.delete({ where: { slug } }),

  upsertBySlug: (slug: string, create: Prisma.SkillCreateInput, update: Prisma.SkillUpdateInput) =>
    prisma.skill.upsert({ where: { slug }, create, update }),

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
