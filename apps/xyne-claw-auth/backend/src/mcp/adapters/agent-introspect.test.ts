import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ findMany: vi.fn() }));
vi.mock("../../db.js", () => ({
  prisma: { agent: { findMany: mocks.findMany } },
}));

import { handleListAgents } from "./agent-introspect.js";

describe("list_agents", () => {
  beforeEach(() => mocks.findMany.mockReset());

  it("returns owner and non-secret agent metadata", async () => {
    mocks.findMany.mockResolvedValue([{
      id: "agent-1",
      slug: "helper",
      name: "Helper",
      description: "Helps",
      scope: "personal",
      delegationTier: "standard",
      ownerUserId: "user-1",
      owner: { id: "user-1", name: "Ada", email: "ada@example.com" },
      orgId: "org-1",
      enabled: true,
      isDefault: false,
      color: "#123456",
      modelId: "model-1",
      kbScope: "COLLECTIONS",
      activePromptVersion: 3,
      createdAt: new Date("2026-08-01T00:00:00Z"),
      updatedAt: new Date("2026-08-02T00:00:00Z"),
      promotedBy: null,
      promotedAt: null,
      config: { tools: { custom: ["webfetch"] } },
      skills: [{ skill: { slug: "triage", name: "Triage" } }],
      _count: { collections: 2 },
    }]);

    const result = JSON.parse(await handleListAgents({}, "org-1"));

    expect(result.agents[0]).toMatchObject({
      id: "agent-1",
      ownerUserId: "user-1",
      createdBy: "user-1",
      owner: { id: "user-1", name: "Ada", email: "ada@example.com" },
      orgId: "org-1",
      tools: { custom: ["webfetch"] },
      skills: ["triage"],
      skillDetails: [{ slug: "triage", name: "Triage" }],
      kbGrants: 2,
    });
    expect(result.agents[0]).not.toHaveProperty("config");
    expect(mocks.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { orgId: "org-1" },
      select: expect.objectContaining({
        ownerUserId: true,
        owner: { select: { id: true, name: true, email: true } },
      }),
    }));
  });
});
