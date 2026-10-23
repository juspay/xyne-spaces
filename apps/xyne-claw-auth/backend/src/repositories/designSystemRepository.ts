import { Prisma, type DesignSystem } from "@prisma/client";
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
}

export type DesignSystemUpdate = Partial<Omit<DesignSystemInput, "name">> & {
  name?: string | undefined;
};

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
    prisma.designSystem.create({
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
    }),

  /** Content edits bump `version`; a rename on its own does not. */
  update: async (
    id: string,
    orgId: string,
    input: DesignSystemUpdate,
  ): Promise<DesignSystem | null> => {
    const existing = await prisma.designSystem.findFirst({ where: { id, orgId } });
    if (!existing) return null;
    const contentChanged =
      (input.designMd !== undefined && input.designMd !== existing.designMd) ||
      (input.tokensCss !== undefined && input.tokensCss !== existing.tokensCss) ||
      input.assets !== undefined;
    return prisma.designSystem.update({
      where: { id: existing.id },
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
  },

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

  findConversationPin: async (
    conversationId: string,
    orgId: string,
  ): Promise<DesignSystem | null> => {
    const pin = await prisma.chatConversationDesignSystem.findFirst({
      where: { conversationId, orgId },
      include: { designSystem: true },
    });
    return pin?.designSystem ?? null;
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
