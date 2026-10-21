import { type ChatProject, type ChatProjectItem } from "@prisma/client";
import { prisma } from "../db.js";
import { ownerUserIdFilter, userIdFilter } from "./userIdFilter.js";

/**
 * Chat projects: a folder of Xyne AI chats carrying shared instructions.
 *
 * Every read and write is alias-aware. A caller can present more than one
 * verified id (canonical Claw id and raw Spaces id), and chat rows may be keyed
 * under either, so a lookup that matches a single id silently loses a user's
 * own projects. Writes still persist under ONE id, chosen by the caller — the
 * same id the conversation's chat rows already use.
 *
 * Membership lives on ChatProjectItem keyed [conversationId, userId], never on
 * ChatConversationMeta: that table has a row per agent and a chat can span
 * agents.
 */

export interface ChatProjectInput {
  name: string;
  icon?: string | null | undefined;
  instructions?: string | undefined;
  instructionsEnabled?: boolean | undefined;
  /**
   * Stored as given: nothing here checks that the caller can see the Spaces
   * project, so a user can link one they have no access to. Whatever pulls
   * that project's tickets or channels into a run MUST re-check access against
   * the caller every time (XYNE-66811) — a stored id is not proof of access.
   */
  spacesProjectId?: string | null | undefined;
  /** Not validated here; check the agent exists and the caller may invoke it
   *  at the point the default is APPLIED. */
  defaultAgentSlug?: string | null | undefined;
}

export type ChatProjectUpdate = Partial<Omit<ChatProjectInput, "name">> & {
  name?: string | undefined;
};

export interface ChatProjectMembership {
  conversationId: string;
  userId: string;
  projectId: string;
  orgId: string;
}

export const chatProjectRepository = {
  /** Newest-ordered by the user's own arrangement; ties fall back to age. */
  listForOwner: (userIds: string | string[], orgId: string): Promise<ChatProject[]> =>
    prisma.chatProject.findMany({
      where: { ...ownerUserIdFilter(userIds), orgId },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    }),

  /**
   * The owner-only gate every mutating route runs first. Returns null both when
   * the project does not exist and when it belongs to someone else, so callers
   * answer 404 either way and never confirm an id they may not see.
   */
  findOwned: (
    id: string,
    userIds: string | string[],
    orgId: string,
  ): Promise<ChatProject | null> =>
    prisma.chatProject.findFirst({ where: { id, orgId, ...ownerUserIdFilter(userIds) } }),

  create: async (
    ownerUserId: string,
    orgId: string,
    input: ChatProjectInput,
    aliases: string | string[] = ownerUserId,
  ): Promise<ChatProject> => {
    // New projects land at the end of the owner's existing order. The lookup
    // spans EVERY alias: projects stored under the caller's other verified id
    // are still theirs, and missing them restarts numbering at 0, which puts
    // the new project at the top of the list instead of the bottom.
    const last = await prisma.chatProject.findFirst({
      where: { ...ownerUserIdFilter(aliases), orgId },
      orderBy: { sortOrder: "desc" },
      select: { sortOrder: true },
    });
    return prisma.chatProject.create({
      data: {
        ownerUserId,
        orgId,
        name: input.name,
        icon: input.icon ?? null,
        instructions: input.instructions ?? "",
        ...(input.instructionsEnabled === undefined
          ? {}
          : { instructionsEnabled: input.instructionsEnabled }),
        spacesProjectId: input.spacesProjectId ?? null,
        defaultAgentSlug: input.defaultAgentSlug ?? null,
        sortOrder: (last?.sortOrder ?? -1) + 1,
      },
    });
  },

  update: async (
    id: string,
    userIds: string | string[],
    orgId: string,
    input: ChatProjectUpdate,
  ): Promise<ChatProject | null> => {
    const owned = await prisma.chatProject.findFirst({
      where: { id, orgId, ...ownerUserIdFilter(userIds) },
      select: { id: true },
    });
    if (!owned) return null;
    return prisma.chatProject.update({
      where: { id: owned.id },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.icon !== undefined ? { icon: input.icon } : {}),
        ...(input.instructions !== undefined ? { instructions: input.instructions } : {}),
        ...(input.instructionsEnabled !== undefined
          ? { instructionsEnabled: input.instructionsEnabled }
          : {}),
        ...(input.spacesProjectId !== undefined ? { spacesProjectId: input.spacesProjectId } : {}),
        ...(input.defaultAgentSlug !== undefined
          ? { defaultAgentSlug: input.defaultAgentSlug }
          : {}),
      },
    });
  },

  /**
   * Deleting a project removes the project row and, by cascade, its membership
   * rows. It touches no ChatMessage, so every chat it held returns to the main
   * list rather than disappearing.
   */
  remove: async (id: string, userIds: string | string[], orgId: string): Promise<boolean> => {
    const result = await prisma.chatProject.deleteMany({
      where: { id, orgId, ...ownerUserIdFilter(userIds) },
    });
    return result.count === 1;
  },

  /** Applies the given order to the owner's projects. Ids that are not theirs
   *  match nothing and are skipped rather than erroring. */
  reorder: async (
    userIds: string | string[],
    orgId: string,
    orderedIds: string[],
  ): Promise<number> => {
    if (orderedIds.length === 0) return 0;
    const results = await prisma.$transaction(
      orderedIds.map((id, index) =>
        prisma.chatProject.updateMany({
          where: { id, orgId, ...ownerUserIdFilter(userIds) },
          data: { sortOrder: index },
        }),
      ),
    );
    return results.reduce((total, result) => total + result.count, 0);
  },

  /** The instruction text to inject, or "" when absent, disabled or blank —
   *  same contract as userAgentInstructionRepository.getEnabledText. */
  getEnabledInstructions: async (projectId: string): Promise<string> => {
    const row = await prisma.chatProject.findUnique({
      where: { id: projectId },
      select: { instructions: true, instructionsEnabled: true },
    });
    if (!row || !row.instructionsEnabled) return "";
    return (row.instructions ?? "").trim();
  },

  /** What a run needs: the instructions for whichever project holds this chat,
   *  or "" when it is not in one. Single query via the item's relation. */
  enabledInstructionsForConversation: async (
    conversationId: string,
    userIds: string | string[],
  ): Promise<string> => {
    const item = await prisma.chatProjectItem.findFirst({
      where: { conversationId, ...userIdFilter(userIds) },
      select: { project: { select: { instructions: true, instructionsEnabled: true } } },
    });
    if (!item?.project || !item.project.instructionsEnabled) return "";
    return (item.project.instructions ?? "").trim();
  },

  /** Membership for a page of conversations, keyed by conversationId. */
  projectIdsForConversations: async (
    conversationIds: string[],
    userIds: string | string[],
  ): Promise<Map<string, string>> => {
    if (conversationIds.length === 0) return new Map();
    const rows = await prisma.chatProjectItem.findMany({
      where: { conversationId: { in: conversationIds }, ...userIdFilter(userIds) },
      select: { conversationId: true, projectId: true },
    });
    return new Map(rows.map((row) => [row.conversationId, row.projectId]));
  },

  conversationIdsInProject: async (
    projectId: string,
    userIds: string | string[],
  ): Promise<string[]> => {
    const rows = await prisma.chatProjectItem.findMany({
      where: { projectId, ...userIdFilter(userIds) },
      select: { conversationId: true },
      orderBy: { createdAt: "desc" },
    });
    return rows.map((row) => row.conversationId);
  },

  countsByProject: async (
    userIds: string | string[],
    orgId: string,
  ): Promise<Map<string, number>> => {
    const grouped = await prisma.chatProjectItem.groupBy({
      by: ["projectId"],
      where: { orgId, ...userIdFilter(userIds) },
      _count: { projectId: true },
    });
    return new Map(grouped.map((row) => [row.projectId, row._count.projectId]));
  },

  /**
   * Move one chat into a project.
   *
   * `membership.userId` is the single id the row is WRITTEN under — the one the
   * conversation's own chat rows already use. `aliases` is every id the caller
   * is verified under, and any membership row for this chat held under a
   * DIFFERENT alias is removed in the same transaction first.
   *
   * Without that sweep the table's [conversationId, userId] key lets one chat
   * moved once under the Spaces id and again under the canonical id end up with
   * two rows — i.e. in two projects at once — and
   * projectIdsForConversations would return whichever row it read last.
   */
  moveConversation: async (
    membership: ChatProjectMembership,
    aliases: string | string[] = membership.userId,
  ): Promise<ChatProjectItem> => {
    const stale = (Array.isArray(aliases) ? aliases : [aliases]).filter(
      (id) => id !== membership.userId,
    );
    const [, row] = await prisma.$transaction([
      prisma.chatProjectItem.deleteMany({
        where: { conversationId: membership.conversationId, userId: { in: stale } },
      }),
      prisma.chatProjectItem.upsert({
        where: {
          conversationId_userId: {
            conversationId: membership.conversationId,
            userId: membership.userId,
          },
        },
        create: membership,
        update: { projectId: membership.projectId, orgId: membership.orgId },
      }),
    ]);
    return row;
  },

  /** Back to the main list. Never deletes the conversation itself. */
  removeConversation: async (
    conversationId: string,
    userIds: string | string[],
  ): Promise<boolean> => {
    const result = await prisma.chatProjectItem.deleteMany({
      where: { conversationId, ...userIdFilter(userIds) },
    });
    return result.count > 0;
  },
};
