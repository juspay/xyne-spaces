import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Drives the real resolver against a faked chatProjectRepository. The barrel is
 * replaced rather than the prisma client because the real one pulls ~30 modules,
 * some of which reach config.ts and die on a missing ENCRYPTION_KEY at import.
 */

const state = vi.hoisted(() => ({
  memberships: new Map<string, string>(),
  projects: [] as Array<Record<string, any>>,
  throwOn: null as null | "memberships" | "project",
}));

vi.mock("../repositories/index.js", () => ({
  chatProjectRepository: {
    projectIdsForConversations: vi.fn(async (conversationIds: string[]) => {
      if (state.throwOn === "memberships") throw new Error("db down");
      const hits = new Map<string, string>();
      for (const id of conversationIds) {
        const projectId = state.memberships.get(id);
        if (projectId) hits.set(id, projectId);
      }
      return hits;
    }),
    findOwned: vi.fn(async (id: string, userIds: string | string[], orgId: string) => {
      if (state.throwOn === "project") throw new Error("db down");
      const ids = Array.isArray(userIds) ? userIds : [userIds];
      return (
        state.projects.find(
          (p) => p["id"] === id && ids.includes(p["ownerUserId"]) && p["orgId"] === orgId,
        ) ?? null
      );
    }),
  },
}));

vi.mock("../logger.js", () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

import { resolveProjectInstructions } from "./project-context.js";

const USER = "user-1";
const ORG = "org-1";
const CONV = "chat-1";

const addProject = (overrides: Record<string, unknown> = {}): void => {
  state.projects.push({
    id: "proj-1",
    ownerUserId: USER,
    orgId: ORG,
    instructions: "Cite your sources.",
    instructionsEnabled: true,
    ...overrides,
  });
};

describe("resolveProjectInstructions", () => {
  beforeEach(() => {
    state.memberships = new Map();
    state.projects = [];
    state.throwOn = null;
    vi.clearAllMocks();
  });

  it("returns the instructions for a chat filed in a project", async () => {
    state.memberships.set(CONV, "proj-1");
    addProject();

    expect(await resolveProjectInstructions(CONV, USER, ORG)).toBe("Cite your sources.");
  });

  it("returns null when the owner switched instructions off", async () => {
    state.memberships.set(CONV, "proj-1");
    addProject({ instructionsEnabled: false });

    expect(await resolveProjectInstructions(CONV, USER, ORG)).toBeNull();
  });

  it("returns null when the project has no instructions", async () => {
    state.memberships.set(CONV, "proj-1");
    addProject({ instructions: "   " });

    expect(await resolveProjectInstructions(CONV, USER, ORG)).toBeNull();
  });

  it("returns null for an unfiled chat", async () => {
    addProject();

    expect(await resolveProjectInstructions(CONV, USER, ORG)).toBeNull();
  });

  it("returns null when the project is not the caller's", async () => {
    state.memberships.set(CONV, "proj-1");
    addProject({ ownerUserId: "someone-else" });

    expect(await resolveProjectInstructions(CONV, USER, ORG)).toBeNull();
  });

  it("returns null when the project belongs to another org", async () => {
    state.memberships.set(CONV, "proj-1");
    addProject({ orgId: "org-2" });

    expect(await resolveProjectInstructions(CONV, USER, ORG)).toBeNull();
  });

  it("matches a chat filed under any of the caller's ids", async () => {
    state.memberships.set(CONV, "proj-1");
    addProject({ ownerUserId: "user-spaces-alias" });

    expect(await resolveProjectInstructions(CONV, [USER, "user-spaces-alias"], ORG)).toBe(
      "Cite your sources.",
    );
  });

  it("returns null without an org, which would otherwise skip the tenant check", async () => {
    state.memberships.set(CONV, "proj-1");
    addProject();

    expect(await resolveProjectInstructions(CONV, USER, undefined)).toBeNull();
  });

  it("caps very long instructions", async () => {
    state.memberships.set(CONV, "proj-1");
    addProject({ instructions: "x".repeat(10_500) });

    const got = await resolveProjectInstructions(CONV, USER, ORG);

    expect(got).toHaveLength(10_000);
  });

  it("returns null rather than throwing when the membership lookup fails", async () => {
    state.throwOn = "memberships";

    expect(await resolveProjectInstructions(CONV, USER, ORG)).toBeNull();
  });

  it("returns null rather than throwing when the project lookup fails", async () => {
    state.memberships.set(CONV, "proj-1");
    addProject();
    state.throwOn = "project";

    expect(await resolveProjectInstructions(CONV, USER, ORG)).toBeNull();
  });
});
