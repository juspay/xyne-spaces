import { type ChatProjectKnowledge, Prisma } from "@prisma/client";
import { prisma } from "../db.js";

/**
 * Files, KB collections and Spaces entities attached to a chat project.
 *
 * Every function takes the orgId its caller read off the parent ChatProject
 * row, never one supplied by the client. The route layer resolves that row
 * through chatProjectRepository.findOwned, so reaching this repository already
 * means the caller owns the project.
 */

export const CHAT_PROJECT_KNOWLEDGE_TYPES = [
  "file",
  "kb_collection",
  "channel",
  "ticket",
  "canvas",
] as const;

export type ChatProjectKnowledgeType = (typeof CHAT_PROJECT_KNOWLEDGE_TYPES)[number];

export function isChatProjectKnowledgeType(value: unknown): value is ChatProjectKnowledgeType {
  return (
    typeof value === "string" &&
    (CHAT_PROJECT_KNOWLEDGE_TYPES as readonly string[]).includes(value)
  );
}

export interface ChatProjectKnowledgeInput {
  type: ChatProjectKnowledgeType;
  refId: string;
  title: string;
  storagePath?: string | null | undefined;
  mimeType?: string | null | undefined;
  size?: number | null | undefined;
  metadata?: Prisma.InputJsonValue | undefined;
}

/** Thrown when the same item is attached to a project twice. */
export class DuplicateKnowledgeError extends Error {
  constructor() {
    super("Item is already attached to this project");
    this.name = "DuplicateKnowledgeError";
  }
}

export const chatProjectKnowledgeRepository = {
  listForProject: (projectId: string, orgId: string): Promise<ChatProjectKnowledge[]> =>
    prisma.chatProjectKnowledge.findMany({
      where: { projectId, orgId },
      orderBy: { createdAt: "asc" },
    }),

  /**
   * `orgId` is the parent project's, passed in by the route after findOwned —
   * it is never taken from the request body.
   */
  create: async (
    projectId: string,
    orgId: string,
    addedByUserId: string,
    input: ChatProjectKnowledgeInput,
  ): Promise<ChatProjectKnowledge> => {
    try {
      return await prisma.chatProjectKnowledge.create({
        data: {
          projectId,
          orgId,
          addedByUserId,
          type: input.type,
          refId: input.refId,
          title: input.title,
          storagePath: input.storagePath ?? null,
          mimeType: input.mimeType ?? null,
          size: input.size ?? null,
          ...(input.metadata === undefined ? {} : { metadata: input.metadata }),
        },
      });
    } catch (err) {
      // P2002 is the [projectId, type, refId] unique index: the same item is
      // already attached, which is a 409 rather than a failure.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        throw new DuplicateKnowledgeError();
      }
      throw err;
    }
  },

  /** Scoped by project and org as well as id, so an id from another project
   *  cannot be deleted. Returns false when nothing matched. */
  deleteOwned: async (id: string, projectId: string, orgId: string): Promise<boolean> => {
    const { count } = await prisma.chatProjectKnowledge.deleteMany({
      where: { id, projectId, orgId },
    });
    return count > 0;
  },
};
