import type { Prisma } from "@prisma/client";
import { prisma } from "../db.js";
import { createLogger } from "../logger.js";
import { hashSkillContent, normalizeSkillContent } from "xyne-claw-shared";

const log = createLogger("skill-version-repository");

/**
 * A file as stored inside a SkillVersion.filesSnapshot JSON array. Mirrors the
 * live SkillFile shape but is a frozen copy captured at the moment the version
 * was cut, so a pinned agent materializes exactly the bundle it was reviewed
 * with — independent of later edits to the live skill.
 */
export interface SnapshotFile {
  relativePath: string;
  content: string;
  contentType?: string | null;
  sizeBytes?: number;
}

export type VersionSource =
  | "initial"
  | "direct_edit"
  | "files_edit"
  | "proposal_approved";

/**
 * Snapshot the live SkillFile rows for a skill into the frozen array shape used
 * by SkillVersion.filesSnapshot. Ordered by relativePath so two snapshots of
 * the same on-disk state hash/compare identically.
 */
export async function snapshotCurrentFiles(skillId: string): Promise<SnapshotFile[]> {
  const files = await prisma.skillFile.findMany({
    where: { skillId },
    orderBy: { relativePath: "asc" },
    select: { relativePath: true, content: true, contentType: true, sizeBytes: true },
  });
  return files.map((f) => ({
    relativePath: f.relativePath,
    content: f.content,
    contentType: f.contentType ?? null,
    sizeBytes: f.sizeBytes ?? undefined,
  }));
}

export const skillVersionRepository = {
  findById: (id: string) => prisma.skillVersion.findUnique({ where: { id } }),

  /** Re-pin a specific agent's use of a skill to a version (adopt accept). */
  pinAgentSkill: (agentId: string, skillId: string, versionId: string) =>
    prisma.agentSkill.updateMany({
      where: { agentId, skillId },
      data: { pinnedVersionId: versionId },
    }),

  /** Minimal owner context for an agent (adopt-request authorization). */
  agentAdoptContext: (agentId: string) =>
    prisma.agent.findUnique({
      where: { id: agentId },
      select: { id: true, slug: true, ownerUserId: true },
    }),

  findBySkill: (skillId: string) =>
    prisma.skillVersion.findMany({ where: { skillId }, orderBy: { version: "desc" } }),

  findByVersion: (skillId: string, version: number) =>
    prisma.skillVersion.findUnique({ where: { skillId_version: { skillId, version } } }),

  /** The skill's current live version row (via Skill.currentVersionId). */
  findCurrent: async (skillId: string) => {
    const skill = await prisma.skill.findUnique({
      where: { id: skillId },
      select: { currentVersionId: true },
    });
    if (!skill?.currentVersionId) return null;
    return prisma.skillVersion.findUnique({ where: { id: skill.currentVersionId } });
  },

  /**
   * Append an immutable version snapshot and repoint Skill.currentVersionId to
   * it, in one transaction. The version number is the current MAX+1 for the
   * skill (computed inside the txn to avoid a race with a concurrent writer).
   *
   * No-op guard: if the normalized content AND the files snapshot are identical
   * to the current version, no row is written and the existing current version
   * is returned with `created: false`. This keeps idempotent re-saves (the UI
   * PUTs the same body twice, an approve replays) from inflating the history.
   *
   * `files` may be passed explicitly (e.g. the files-edit path already computed
   * the new set); when omitted the current SkillFile rows are snapshotted.
   */
  appendVersion: async (args: {
    skillId: string;
    content: string;
    authorUserId?: string | null;
    source: VersionSource;
    changelog?: string | null;
    files?: SnapshotFile[];
  }): Promise<{ version: Prisma.SkillVersionGetPayload<object>; created: boolean }> => {
    const normalized = normalizeSkillContent(args.content);
    const contentHash = hashSkillContent(normalized);
    const files = args.files ?? (await snapshotCurrentFiles(args.skillId));
    // Canonical, order-independent fingerprint of the files bundle for the
    // no-op guard. relativePath is already the snapshot's sort key.
    const filesFingerprint = JSON.stringify(
      [...files]
        .sort((a, b) => a.relativePath.localeCompare(b.relativePath))
        .map((f) => [f.relativePath, hashSkillContent(f.content ?? ""), f.contentType ?? null]),
    );

    return prisma.$transaction(async (tx) => {
      const current = await tx.skill.findUnique({
        where: { id: args.skillId },
        select: { currentVersionId: true },
      });
      if (current?.currentVersionId) {
        const cur = await tx.skillVersion.findUnique({ where: { id: current.currentVersionId } });
        if (cur && cur.contentHash === contentHash) {
          const curFiles = Array.isArray(cur.filesSnapshot) ? (cur.filesSnapshot as unknown as SnapshotFile[]) : [];
          const curFingerprint = JSON.stringify(
            [...curFiles]
              .sort((a, b) => a.relativePath.localeCompare(b.relativePath))
              .map((f) => [f.relativePath, hashSkillContent(f.content ?? ""), f.contentType ?? null]),
          );
          if (curFingerprint === filesFingerprint) {
            return { version: cur, created: false };
          }
        }
      }

      const max = await tx.skillVersion.aggregate({
        where: { skillId: args.skillId },
        _max: { version: true },
      });
      const nextVersion = (max._max.version ?? 0) + 1;

      const created = await tx.skillVersion.create({
        data: {
          skillId: args.skillId,
          version: nextVersion,
          content: normalized,
          contentHash,
          filesSnapshot: files as unknown as Prisma.InputJsonValue,
          authorUserId: args.authorUserId ?? null,
          source: args.source,
          changelog: args.changelog ?? null,
        },
      });

      await tx.skill.update({
        where: { id: args.skillId },
        data: { currentVersionId: created.id },
      });

      log.info(
        `[skill-version] cut v${nextVersion} skill=${args.skillId} source=${args.source} hash=${contentHash.slice(0, 8)} files=${files.length}`,
      );
      return { version: created, created: true };
    });
  },
};
