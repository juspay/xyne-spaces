import { Prisma, type DesignSystem, type DesignSystemVersion } from "@prisma/client";
import { formatContentChangeSummary } from "xyne-claw-shared";
import { prisma } from "../db.js";

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

export const DESIGN_SYSTEM_MAX_CHARS = 32_000;

export const DESIGN_SYSTEM_SOURCES = ["manual", "url", "screenshot", "repo", "file", "library"] as const;
export type DesignSystemSource = (typeof DESIGN_SYSTEM_SOURCES)[number];

export const isDesignSystemSource = (value: unknown): value is DesignSystemSource =>
  typeof value === "string" && (DESIGN_SYSTEM_SOURCES as readonly string[]).includes(value);

/** Where a resolved system came from. "legacy" means the pre-migration
 *  `agent.config.designSystem` text, which has no row behind it. */
export type DesignSystemOrigin = "conversation" | "agent" | "legacy";

export interface ResolvedDesignSystem {
  id: string | null;
  name: string;
  designMd: string;
  tokensCss: string;
  origin: DesignSystemOrigin;
}

interface AgentLike {
  orgId: string;
  config: Prisma.JsonValue;
}

export interface DesignSystemInput {
  name: string;
  designMd?: string | undefined;
  tokensCss?: string | undefined;
  assets?: Prisma.InputJsonValue | null | undefined;
  source?: DesignSystemSource | undefined;
  sourceUrl?: string | null | undefined;
  sourceRepo?: string | null | undefined;
  sourceCommit?: string | null | undefined;
  /** One line describing this revision, stored on its version row. A re-import
   *  knows the token-level diff and should pass it; absent, the repository
   *  derives a line-level one. */
  changeSummary?: string | undefined;
}

export type DesignSystemUpdate = Partial<Omit<DesignSystemInput, "name">> & {
  name?: string | undefined;
  /** Who is making this edit, credited on the version row. */
  updatedBy?: string | undefined;
  /**
   * The version the caller believes it is editing. When given, the write only
   * lands if the row is still on it.
   *
   * The re-import flow shows a diff against a version and saves on approval,
   * which is a read, a human pause, and then a write. Without this, a save in
   * that window is overwritten silently AND the new version row's summary
   * describes a transition from content that is no longer the previous version
   * — the history would be wrong, not just the content.
   */
  expectedVersion?: number | undefined;
};

export type DesignSystemUpdateResult =
  | { status: "updated"; row: DesignSystem }
  | { status: "not-found" }
  | { status: "conflict"; currentVersion: number };

/** JSON equality that ignores key order, for deciding whether `assets` moved. */
function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`)
    .join(",")}}`;
}

const sameJson = (a: unknown, b: unknown): boolean => stableJson(a) === stableJson(b);

const resolved = (row: DesignSystem, origin: DesignSystemOrigin): ResolvedDesignSystem => ({
  id: row.id,
  name: row.name,
  designMd: row.designMd,
  tokensCss: row.tokensCss,
  origin,
});

export const designSystemRepository = {
  listByOrg: (orgId: string): Promise<DesignSystem[]> =>
    prisma.designSystem.findMany({ where: { orgId }, orderBy: { updatedAt: "desc" } }),

  findById: (id: string, orgId: string): Promise<DesignSystem | null> =>
    prisma.designSystem.findFirst({ where: { id, orgId } }),

  create: (orgId: string, createdBy: string, input: DesignSystemInput): Promise<DesignSystem> =>
    // The v1 snapshot is written here, not on the first edit, so the history is
    // complete from the row's first moment and `getVersion(id, 1)` answers for
    // a system nobody has edited yet.
    prisma.$transaction(async (tx) => {
      const created = await tx.designSystem.create({
        data: {
          orgId,
          createdBy,
          name: input.name,
          designMd: input.designMd ?? "",
          tokensCss: input.tokensCss ?? "",
          ...(input.assets === undefined ? {} : { assets: input.assets ?? Prisma.DbNull }),
          ...(input.source ? { source: input.source } : {}),
          sourceUrl: input.sourceUrl ?? null,
          sourceRepo: input.sourceRepo ?? null,
          sourceCommit: input.sourceCommit ?? null,
        },
      });
      await tx.designSystemVersion.create({
        data: {
          orgId,
          designSystemId: created.id,
          version: created.version,
          designMd: created.designMd,
          tokensCss: created.tokensCss,
          ...(created.assets === null ? {} : { assets: created.assets as Prisma.InputJsonValue }),
          changeSummary: input.changeSummary ?? "Created",
          createdBy,
        },
      });
      return created;
    }),

  /**
   * Content edits bump `version` and archive the new content under it; a rename
   * on its own does neither.
   *
   * Both writes share one transaction, and the version number comes from the
   * update's own result. Reading `existing.version` and adding one outside a
   * transaction would let two concurrent edits pick the same number, and one of
   * them would die on the `[designSystemId, version]` unique constraint — which
   * is a real rejection from Postgres, not a theoretical one.
   *
   * The change summary is computed BEFORE the transaction opens. It diffs the
   * two documents line by line, which costs the product of their line counts,
   * and the routes accept 64k characters of token CSS — tens of thousands of
   * short lines. Inside the transaction that work held a row lock while it ran,
   * so one large save could pass Prisma's 5s interactive-transaction timeout and
   * roll back a legitimate edit as a 500. Out here it holds nothing, and
   * MAX_DIFF_CELLS bounds the work itself.
   */
  update: async (
    id: string,
    orgId: string,
    input: DesignSystemUpdate,
  ): Promise<DesignSystemUpdateResult> => {
    const existing = await prisma.designSystem.findFirst({ where: { id, orgId } });
    if (!existing) return { status: "not-found" };

    const nextDesignMd = input.designMd ?? existing.designMd;
    const nextTokensCss = input.tokensCss ?? existing.tokensCss;
    // By value, not by presence. A form that posts every field on every save
    // sends `assets` unchanged, and treating that as a change minted a version
    // per click, each one summarised "No changes to DESIGN.md or tokens.css".
    const assetsChanged =
      input.assets !== undefined && !sameJson(input.assets ?? null, existing.assets);
    const contentChanged =
      nextDesignMd !== existing.designMd || nextTokensCss !== existing.tokensCss || assetsChanged;

    const changeSummary = !contentChanged
      ? undefined
      : (input.changeSummary ??
        formatContentChangeSummary({
          oldDesignMd: existing.designMd,
          newDesignMd: nextDesignMd,
          oldTokensCss: existing.tokensCss,
          newTokensCss: nextTokensCss,
        }));
    const editor = input.updatedBy ?? existing.createdBy;

    return prisma.$transaction(async (tx) => {
      // updateMany so `version` can join the filter: `update` needs a unique
      // where, and this is how the write refuses to land on a row someone else
      // has moved since `existing` was read.
      const written = await tx.designSystem.updateMany({
        where: {
          id: existing.id,
          orgId,
          ...(input.expectedVersion === undefined ? {} : { version: input.expectedVersion }),
        },
        data: {
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.designMd !== undefined ? { designMd: input.designMd } : {}),
          ...(input.tokensCss !== undefined ? { tokensCss: input.tokensCss } : {}),
          ...(input.assets === undefined ? {} : { assets: input.assets ?? Prisma.DbNull }),
          ...(input.source !== undefined ? { source: input.source } : {}),
          ...(input.sourceUrl !== undefined ? { sourceUrl: input.sourceUrl } : {}),
          ...(input.sourceRepo !== undefined ? { sourceRepo: input.sourceRepo } : {}),
          ...(input.sourceCommit !== undefined ? { sourceCommit: input.sourceCommit } : {}),
          ...(contentChanged ? { version: { increment: 1 } } : {}),
        },
      });
      if (written.count === 0) {
        // Re-read rather than reporting `existing.version`, so the caller is
        // told where the row actually is now and can diff against that.
        const current = await tx.designSystem.findFirst({ where: { id: existing.id, orgId } });
        if (!current) return { status: "not-found" };
        return { status: "conflict", currentVersion: current.version };
      }
      const updated = await tx.designSystem.findUniqueOrThrow({ where: { id: existing.id } });
      if (!contentChanged) return { status: "updated", row: updated };
      await tx.designSystemVersion.create({
        data: {
          orgId,
          designSystemId: updated.id,
          version: updated.version,
          designMd: updated.designMd,
          tokensCss: updated.tokensCss,
          ...(updated.assets === null ? {} : { assets: updated.assets as Prisma.InputJsonValue }),
          ...(changeSummary === undefined ? {} : { changeSummary }),
          // Who made the edit, not who created the system. The caller supplies
          // it; falling back to the system's creator would credit the wrong
          // person for every edit anyone else makes.
          createdBy: editor,
        },
      });
      return { status: "updated", row: updated };
    });
  },

  /**
   * Newest first, capped. A system edited daily for a year would otherwise
   * return 365 rows carrying two documents each; the cap matches
   * loop_command_versions. Nothing prunes history, so this is a read bound and
   * not a retention policy.
   */
  listVersions: (
    designSystemId: string,
    orgId: string,
    take = 50,
  ): Promise<DesignSystemVersion[]> =>
    prisma.designSystemVersion.findMany({
      where: { designSystemId, orgId },
      orderBy: { version: "desc" },
      take,
    }),

  /** One archived revision, or null. Org-scoped like every other read here, so
   *  a known id from another org cannot be read by guessing version numbers. */
  getVersion: (
    designSystemId: string,
    version: number,
    orgId: string,
  ): Promise<DesignSystemVersion | null> =>
    prisma.designSystemVersion.findFirst({ where: { designSystemId, version, orgId } }),

  /** Conversation pins cascade with the row; agents keep a dangling
   *  `config.designSystemId`, which resolveForAgent treats as absent. */
  remove: async (id: string, orgId: string): Promise<boolean> => {
    const result = await prisma.designSystem.deleteMany({ where: { id, orgId } });
    return result.count === 1;
  },

  pinConversation: (
    conversationId: string,
    designSystemId: string,
    orgId: string,
    setByUserId: string,
  ) =>
    prisma.chatConversationDesignSystem.upsert({
      where: { conversationId },
      create: { conversationId, designSystemId, orgId, setByUserId },
      update: { designSystemId, setByUserId },
    }),

  unpinConversation: async (conversationId: string): Promise<boolean> => {
    const result = await prisma.chatConversationDesignSystem.deleteMany({ where: { conversationId } });
    return result.count === 1;
  },

  /**
   * The one resolution order every caller must share: a conversation's own pin
   * beats the agent's default, which beats the pre-migration
   * `agent.config.designSystem` text. Returns null when the agent has no system
   * at all. Callers on the dispatch path must treat a throw as "no system" —
   * this is the first DB read on that path, so a blip must not fail the run.
   */
  resolveForAgent: async (
    agent: AgentLike,
    conversationId?: string | null,
  ): Promise<ResolvedDesignSystem | null> => {
    if (conversationId) {
      const pin = await prisma.chatConversationDesignSystem.findUnique({
        where: { conversationId },
        include: { designSystem: true },
      });
      if (pin && pin.designSystem.orgId === agent.orgId) return resolved(pin.designSystem, "conversation");
    }

    const config = asRecord(agent.config) ?? {};

    const defaultId = config["designSystemId"];
    if (typeof defaultId === "string" && defaultId) {
      const row = await prisma.designSystem.findFirst({ where: { id: defaultId, orgId: agent.orgId } });
      if (row) return resolved(row, "agent");
    }

    const legacy = config["designSystem"];
    if (typeof legacy === "string" && legacy.trim()) {
      return {
        id: null,
        name: "Design system",
        designMd: legacy.trim(),
        tokensCss: "",
        origin: "legacy",
      };
    }

    return null;
  },
};
