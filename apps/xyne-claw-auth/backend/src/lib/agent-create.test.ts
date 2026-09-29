import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";

const tx = {
  agent: { create: vi.fn(), update: vi.fn() },
  agentSkill: { createMany: vi.fn() },
  agentCollection: { createMany: vi.fn() },
  agentPromptVersion: { create: vi.fn() },
};

vi.mock("../db.js", () => ({
  prisma: { $transaction: (fn: (client: typeof tx) => Promise<unknown>) => fn(tx) },
}));

import { createAgentRecord } from "./agent-create.js";
import { HttpError } from "./http.js";

const data = {
  slug: "morning-brief",
  name: "Morning Brief",
  systemPrompt: "prompt",
  org: { connect: { id: "org_1" } },
} as Prisma.AgentCreateInput;

describe("createAgentRecord", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    tx.agent.create.mockResolvedValue({ id: "agent_1", slug: "morning-brief", systemPrompt: "prompt" });
    tx.agentPromptVersion.create.mockResolvedValue({ id: "ver_1", version: 1 });
    tx.agent.update.mockResolvedValue({ id: "agent_1", slug: "morning-brief" });
  });

  it("creates the agent, skills, grants and prompt v1 in one transaction", async () => {
    await createAgentRecord({
      data,
      skillIds: ["s1", "s1", "s2"],
      collections: [
        { collectionId: "c1", fileId: null },
        { collectionId: "c1", fileId: null },
      ],
      createdByUserId: "user_1",
    });

    expect(tx.agentSkill.createMany).toHaveBeenCalledWith({
      data: [
        { agentId: "agent_1", skillId: "s1" },
        { agentId: "agent_1", skillId: "s2" },
      ],
      skipDuplicates: true,
    });
    expect(tx.agentCollection.createMany).toHaveBeenCalledWith({
      data: [{ agentId: "agent_1", collectionId: "c1", fileId: null }],
      skipDuplicates: true,
    });
    expect(tx.agentPromptVersion.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ agentId: "agent_1", version: 1, systemPrompt: "prompt" }),
    });
    expect(tx.agent.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { activePromptVersionId: "ver_1", activePromptVersion: 1 } }),
    );
  });

  it("skips empty attachments", async () => {
    await createAgentRecord({ data, skillIds: [], collections: [], createdByUserId: null });
    expect(tx.agentSkill.createMany).not.toHaveBeenCalled();
    expect(tx.agentCollection.createMany).not.toHaveBeenCalled();
  });

  it("turns a duplicate handle into a 409 SLUG_TAKEN", async () => {
    tx.agent.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
        code: "P2002",
        clientVersion: "test",
      }),
    );
    const error = await createAgentRecord({ data, skillIds: [], collections: [], createdByUserId: null }).catch(
      (err: unknown) => err,
    );
    expect(error).toBeInstanceOf(HttpError);
    expect((error as HttpError).status).toBe(409);
    expect((error as HttpError).code).toBe("SLUG_TAKEN");
  });
});
