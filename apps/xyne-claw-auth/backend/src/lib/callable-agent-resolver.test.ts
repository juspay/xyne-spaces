import { describe, expect, it, vi } from "vitest";
import type { AppPrismaClient } from "../db.js";
import {
  resolveCallableAgentSpecForOrchestratorCall,
  resolveCallableAgentsForRun,
  resolveOrchestratorCallableAgentsForRun,
} from "./callable-agent-resolver.js";

vi.mock("./agent-provider-config.js", () => ({
  resolveAgentProviderConfigs: vi.fn().mockResolvedValue({
    providerConfigs: {},
    providerOrder: [],
  }),
}));

vi.mock("./subagent-resolver.js", () => ({
  resolveCustomSubagentsForRun: vi.fn().mockResolvedValue([]),
}));

function prismaMock(overrides: Record<string, unknown> = {}): AppPrismaClient {
  return {
    agent: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      findFirst: vi.fn(),
    },
    agentDelegationGrant: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
    },
    user: { findUnique: vi.fn() },
    userRole: { findUnique: vi.fn() },
    ...overrides,
  } as unknown as AppPrismaClient;
}

const everyone = {};
const onlyAllowedUser = { privacy: { mode: "whitelist", whitelist: ["user-allowed"] } };
const denyEveryone = { privacy: { mode: "whitelist", whitelist: [] } };

function lightAgent(id: string, slug: string, config: Record<string, unknown>) {
  return { id, slug, name: slug, description: `${slug} description`, config };
}

describe("resolveOrchestratorCallableAgentsForRun privacy", () => {
  it("omits a global restricted agent for a user outside its whitelist", async () => {
    const prisma = prismaMock();
    vi.mocked(prisma.agent.findMany)
      .mockResolvedValueOnce([lightAgent("restricted-id", "restricted", onlyAllowedUser)] as never)
      .mockResolvedValueOnce([] as never);
    vi.mocked(prisma.agentDelegationGrant.findMany).mockResolvedValue([] as never);

    const specs = await resolveOrchestratorCallableAgentsForRun(prisma, "orchestrator-id", "org-1", {
      runningUserId: "user-denied",
    });

    expect(specs).toEqual([]);
  });

  it("does not let an approved personal/shared grant bypass privacy", async () => {
    const prisma = prismaMock();
    vi.mocked(prisma.agent.findMany)
      .mockResolvedValueOnce([] as never)
      .mockResolvedValueOnce([lightAgent("restricted-id", "restricted", onlyAllowedUser)] as never);
    vi.mocked(prisma.agentDelegationGrant.findMany).mockResolvedValue([
      { calleeAgentId: "restricted-id", identityMode: "user" },
    ] as never);

    const specs = await resolveOrchestratorCallableAgentsForRun(prisma, "orchestrator-id", "org-1", {
      runningUserId: "user-denied",
    });

    expect(specs).toEqual([]);
  });

  it("includes a restricted agent for a whitelisted user", async () => {
    const prisma = prismaMock();
    vi.mocked(prisma.agent.findMany).mockResolvedValueOnce([
      lightAgent("restricted-id", "restricted", onlyAllowedUser),
    ] as never);
    vi.mocked(prisma.agentDelegationGrant.findMany).mockResolvedValue([] as never);

    const specs = await resolveOrchestratorCallableAgentsForRun(prisma, "orchestrator-id", "org-1", {
      runningUserId: "user-allowed",
    });

    expect(specs.map((spec) => spec.slug)).toEqual(["restricted"]);
  });

  it("preserves everyone-mode agents", async () => {
    const prisma = prismaMock();
    vi.mocked(prisma.agent.findMany).mockResolvedValueOnce([
      lightAgent("public-id", "public-agent", everyone),
    ] as never);
    vi.mocked(prisma.agentDelegationGrant.findMany).mockResolvedValue([] as never);

    const specs = await resolveOrchestratorCallableAgentsForRun(prisma, "orchestrator-id", "org-1", {
      runningUserId: "any-user",
    });

    expect(specs.map((spec) => spec.slug)).toEqual(["public-agent"]);
  });

  it("treats an empty whitelist as deny-all, including for admins", async () => {
    const prisma = prismaMock();
    vi.mocked(prisma.agent.findMany).mockResolvedValueOnce([
      lightAgent("locked-id", "locked", denyEveryone),
    ] as never);
    vi.mocked(prisma.agentDelegationGrant.findMany).mockResolvedValue([] as never);

    const specs = await resolveOrchestratorCallableAgentsForRun(prisma, "orchestrator-id", "org-1", {
      runningUserId: "admin-user",
      isAdmin: true,
    });

    expect(specs).toEqual([]);
  });
});

describe("resolveCallableAgentSpecForOrchestratorCall privacy", () => {
  it("re-authorizes a crafted or stale hydration request before returning the callee spec", async () => {
    const prisma = prismaMock();
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ orgId: "org-1" } as never);
    vi.mocked(prisma.userRole.findUnique).mockResolvedValue(null);
    vi.mocked(prisma.agent.findUnique)
      .mockResolvedValueOnce({ id: "orchestrator-id", orgId: "org-1", delegationTier: "orchestrator", enabled: true } as never)
      .mockResolvedValueOnce({
        id: "restricted-id",
        orgId: "org-1",
        slug: "restricted",
        scope: "global",
        enabled: true,
        config: onlyAllowedUser,
        skills: [],
      } as never);
    vi.mocked(prisma.agent.findFirst).mockResolvedValue({ id: "restricted-id" } as never);

    const result = await resolveCallableAgentSpecForOrchestratorCall(prisma, {
      callerSlug: "orchestrator",
      calleeSlug: "restricted",
      userId: "user-denied",
    });

    expect(result).toEqual({ error: "Callee is restricted for the running user", status: 403 });
    expect(prisma.agentDelegationGrant.findUnique).not.toHaveBeenCalled();
  });

  it("hydrates the callee when the running user is whitelisted", async () => {
    const prisma = prismaMock();
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ orgId: "org-1" } as never);
    vi.mocked(prisma.userRole.findUnique).mockResolvedValue(null);
    vi.mocked(prisma.agent.findUnique)
      .mockResolvedValueOnce({ id: "orchestrator-id", orgId: "org-1", delegationTier: "orchestrator", enabled: true } as never)
      .mockResolvedValueOnce({
        id: "restricted-id",
        orgId: "org-1",
        slug: "restricted",
        name: "Restricted",
        description: "restricted description",
        systemPrompt: "restricted prompt",
        modelId: null,
        spacesAppId: null,
        scope: "global",
        enabled: true,
        config: onlyAllowedUser,
        skills: [],
      } as never);
    vi.mocked(prisma.agent.findFirst).mockResolvedValue({ id: "restricted-id" } as never);

    const result = await resolveCallableAgentSpecForOrchestratorCall(prisma, {
      callerSlug: "orchestrator",
      calleeSlug: "restricted",
      userId: "user-allowed",
    });

    expect(result).toMatchObject({
      callerOrgId: "org-1",
      spec: { slug: "restricted", identityMode: "user" },
    });
  });
});

describe("resolveCallableAgentsForRun privacy", () => {
  it("does not let an approved standard delegation grant bypass invocation privacy", async () => {
    const prisma = prismaMock();
    vi.mocked(prisma.agent.findMany)
      .mockResolvedValueOnce([{ ...lightAgent("restricted-id", "restricted", onlyAllowedUser), skills: [] }] as never)
      .mockResolvedValueOnce([{ id: "restricted-id" }] as never);
    vi.mocked(prisma.agentDelegationGrant.findMany).mockResolvedValue([
      { calleeAgentId: "restricted-id", identityMode: "user" },
    ] as never);

    const specs = await resolveCallableAgentsForRun(
      prisma,
      "caller-id",
      ["restricted"],
      "org-1",
      { runningUserId: "user-denied" },
    );

    expect(specs).toEqual([]);
  });
});
