import { Prisma } from "@prisma/client";
import { prisma } from "../db.js";
import { conflict } from "./http.js";

export interface CreateAgentRecordInput {
  data: Prisma.AgentCreateInput;
  /** Skill ids the creator may attach (already filtered to what they can see). */
  skillIds: readonly string[];
  /** KB grants that passed validateKbGrants. */
  collections: ReadonlyArray<{ collectionId: string; fileId: string | null }>;
  createdByUserId: string | null;
}

const CREATE_INCLUDE = {
  tools: { include: { tool: true } },
  skills: { include: { skill: true } },
} satisfies Prisma.AgentInclude;

export type CreatedAgent = Prisma.AgentGetPayload<{ include: typeof CREATE_INCLUDE }>;

function uniqueCollections(
  items: CreateAgentRecordInput["collections"],
): Array<{ collectionId: string; fileId: string | null }> {
  const seen = new Set<string>();
  const out: Array<{ collectionId: string; fileId: string | null }> = [];
  for (const item of items) {
    const key = `${item.collectionId}::${item.fileId ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ collectionId: item.collectionId, fileId: item.fileId ?? null });
  }
  return out;
}

export function isUniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";
}

/**
 * Create an agent with its skills, KB grants and prompt version v1 in one
 * transaction, so a failed attach never leaves a half-made agent behind and a
 * retry never trips over its own row. A taken handle becomes a 409
 * `SLUG_TAKEN` instead of a generic 500.
 */
export async function createAgentRecord(input: CreateAgentRecordInput): Promise<CreatedAgent> {
  const skillIds = [...new Set(input.skillIds)];
  const collections = uniqueCollections(input.collections);
  try {
    return await prisma.$transaction(async (tx) => {
      const agent = await tx.agent.create({ data: input.data });
      if (skillIds.length > 0) {
        await tx.agentSkill.createMany({
          data: skillIds.map((skillId) => ({ agentId: agent.id, skillId })),
          skipDuplicates: true,
        });
      }
      if (collections.length > 0) {
        await tx.agentCollection.createMany({
          data: collections.map((grant) => ({ agentId: agent.id, ...grant })),
          skipDuplicates: true,
        });
      }
      const version = await tx.agentPromptVersion.create({
        data: {
          agentId: agent.id,
          version: 1,
          systemPrompt: agent.systemPrompt,
          note: "Created",
          createdByUserId: input.createdByUserId,
        },
      });
      return tx.agent.update({
        where: { id: agent.id },
        data: { activePromptVersionId: version.id, activePromptVersion: version.version },
        include: CREATE_INCLUDE,
      });
    });
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw conflict(`Handle "${input.data.slug}" is already taken.`, "SLUG_TAKEN");
    }
    throw err;
  }
}
