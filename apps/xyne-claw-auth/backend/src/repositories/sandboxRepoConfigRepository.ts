import { Prisma } from "@prisma/client";
import { DEFAULT_REPO_CONFIGS } from "xyne-claw-shared";
import { prisma } from "../db.js";

interface RepoConfigColumns {
  template: string;
  repoUrl: string | null;
  auxRepos: unknown[] | null;
}

/**
 * The columns that copy config.template, config.repoUrl and config.auxRepos. An empty string is no value.
 * The migration that added the columns fills them by the same rules.
 */
export function repoConfigColumns(config: unknown): RepoConfigColumns {
  const fields = config && typeof config === "object" && !Array.isArray(config) ? (config as Record<string, unknown>) : {};
  const text = (value: unknown): string | null => (typeof value === "string" && value !== "" ? value : null);
  const template = text(fields["template"]);
  if (template === null) throw new Error("sandbox repo config has no template");
  const auxRepos: unknown = fields["auxRepos"];
  return { template, repoUrl: text(fields["repoUrl"]), auxRepos: Array.isArray(auxRepos) ? auxRepos : null };
}

/** config and its columns, always written together so the columns cannot drift from the JSON. */
function stored(config: Prisma.InputJsonValue) {
  const { template, repoUrl, auxRepos } = repoConfigColumns(config);
  return { config, template, repoUrl, auxRepos: auxRepos === null ? Prisma.DbNull : (auxRepos as Prisma.InputJsonArray) };
}

// The row as callers got it before the columns existed; routes send it back as is.
const ROW = {
  id: true,
  key: true,
  config: true,
  enabled: true,
  workspaceId: true,
  createdByUserId: true,
  updatedByUserId: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.SandboxRepoConfigSelect;

/**
 * The copy of a built-in that start-up keeps in the table, untouched by any person. Every route that
 * writes a row requires a user id and stores it in updatedByUserId, so no user on the row marks the copy.
 * A write with a null user id cannot be told from it: do not add one.
 *
 * A system copy only serves listByTemplate. To everything that existed before it, it is no row at all:
 * the code version of the built-in applies, as when the table held nothing for that key.
 */
const SYSTEM_COPY = {
  createdByUserId: null,
  updatedByUserId: null,
  workspaceId: null,
  enabled: true,
} satisfies Prisma.SandboxRepoConfigWhereInput;

const PERSONS_ROW = { NOT: SYSTEM_COPY } satisfies Prisma.SandboxRepoConfigWhereInput;

const systemCopy = (config: Prisma.InputJsonValue) => ({ ...stored(config), ...SYSTEM_COPY });

type InsertedFields = ReturnType<typeof stored> & {
  enabled: boolean;
  updatedByUserId: string | null;
  workspaceId: string | null;
  createdByUserId: string | null;
};

/** A person's insert where a system copy holds the key: the copy becomes the row they would have inserted. */
async function takeOverSystemCopy(key: string, fields: InsertedFields) {
  const [row] = await prisma.sandboxRepoConfig.updateManyAndReturn({
    where: { key, ...SYSTEM_COPY },
    data: { ...fields, createdAt: new Date() },
    select: ROW,
  });
  return row;
}

export const sandboxRepoConfigRepository = {
  list: () => prisma.sandboxRepoConfig.findMany({ where: PERSONS_ROW, orderBy: { key: "asc" }, select: ROW }),

  find: (key: string) => prisma.sandboxRepoConfig.findFirst({ where: { key, ...PERSONS_ROW }, select: ROW }),

  /** Every row with this template, system copies and disabled rows included. */
  listByTemplate: (template: string) =>
    prisma.sandboxRepoConfig.findMany({
      where: { template },
      select: { key: true, template: true, repoUrl: true, auxRepos: true, enabled: true, workspaceId: true },
      orderBy: { key: "asc" },
    }),

  // Plain insert: a key taken meanwhile fails with P2002 instead of being overwritten.
  create: async (key: string, config: Prisma.InputJsonValue, workspaceId: string, userId: string) => {
    const fields = { ...stored(config), enabled: true, updatedByUserId: userId, workspaceId, createdByUserId: userId };
    return (
      (await takeOverSystemCopy(key, fields)) ??
      prisma.sandboxRepoConfig.create({ data: { key, ...fields }, select: ROW })
    );
  },

  // workspaceId and createdByUserId are set on create only; an update never moves a profile.
  upsert: async (
    key: string,
    config: Prisma.InputJsonValue,
    enabled: boolean,
    updatedByUserId: string | null,
    owner: { workspaceId?: string | null; createdByUserId?: string | null } = {},
  ) => {
    const update = { ...stored(config), enabled, updatedByUserId };
    const create = {
      ...update,
      workspaceId: owner.workspaceId ?? null,
      createdByUserId: owner.createdByUserId ?? updatedByUserId,
    };
    return (
      (await takeOverSystemCopy(key, create)) ??
      prisma.sandboxRepoConfig.upsert({ where: { key }, create: { key, ...create }, update, select: ROW })
    );
  },

  setEnabled: (key: string, enabled: boolean, updatedByUserId: string | null) =>
    prisma.sandboxRepoConfig.update({
      where: { key, ...PERSONS_ROW },
      data: { enabled, updatedByUserId },
      select: ROW,
    }),

  listUnowned: (keys?: string[]) =>
    prisma.sandboxRepoConfig.findMany({
      where: { workspaceId: null, ...(keys ? { key: { in: keys } } : {}), ...PERSONS_ROW },
      select: { key: true },
      orderBy: { key: "asc" },
    }),

  assignWorkspace: (keys: string[], workspaceId: string) =>
    prisma.sandboxRepoConfig.updateMany({
      where: { key: { in: keys }, workspaceId: null, ...PERSONS_ROW },
      data: { workspaceId },
    }),

  /** Removes a person's row (P2025 when there is none). A built-in gets its system copy back in its place. */
  delete: async (key: string) => {
    const removePersonsRow = prisma.sandboxRepoConfig.delete({ where: { key, ...PERSONS_ROW }, select: ROW });
    const builtIn = Object.hasOwn(DEFAULT_REPO_CONFIGS, key) ? DEFAULT_REPO_CONFIGS[key] : undefined;
    if (!builtIn) return removePersonsRow;
    const [removed] = await prisma.$transaction([
      removePersonsRow,
      prisma.sandboxRepoConfig.create({
        data: { key, ...systemCopy(builtIn as unknown as Prisma.InputJsonValue) },
        select: { key: true },
      }),
    ]);
    return removed;
  },

  /**
   * Start-up: fill the columns of rows written without them (by a pod still running the release before
   * the columns existed). updatedAt is kept: this is not an edit. Returns the keys it filled.
   */
  fillMissingColumns: async () => {
    const rows = await prisma.sandboxRepoConfig.findMany({
      where: { template: null },
      select: { id: true, key: true, config: true, updatedAt: true },
    });
    const filled: string[] = [];
    for (const row of rows) {
      let columns: ReturnType<typeof stored>;
      try {
        columns = stored(row.config as Prisma.InputJsonValue);
      } catch {
        continue; // no template in config: nothing to copy, and the loader already skips such a row
      }
      const { count } = await prisma.sandboxRepoConfig.updateMany({
        where: { id: row.id, template: null },
        data: { template: columns.template, repoUrl: columns.repoUrl, auxRepos: columns.auxRepos, updatedAt: row.updatedAt },
      });
      if (count > 0) filled.push(row.key);
    }
    return filled;
  },

  /** Start-up: a system copy for every built-in key that has no row. Returns the keys it inserted. */
  insertSystemCopies: async (builtIns: Record<string, Prisma.InputJsonValue>) => {
    const inserted = await prisma.sandboxRepoConfig.createManyAndReturn({
      data: Object.entries(builtIns).map(([key, config]) => ({ key, ...systemCopy(config) })),
      skipDuplicates: true,
      select: { key: true },
    });
    return inserted.map((row) => row.key);
  },

  listSystemCopies: (keys: string[]) =>
    prisma.sandboxRepoConfig.findMany({
      where: { key: { in: keys }, ...SYSTEM_COPY },
      select: { key: true, config: true, template: true, repoUrl: true, auxRepos: true },
      orderBy: { key: "asc" },
    }),

  /** False when a person took the row over in the meantime: theirs is left alone. */
  refreshSystemCopy: async (key: string, config: Prisma.InputJsonValue) => {
    const { count } = await prisma.sandboxRepoConfig.updateMany({ where: { key, ...SYSTEM_COPY }, data: stored(config) });
    return count > 0;
  },
};
