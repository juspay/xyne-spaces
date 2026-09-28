import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  orgId: "org-1" as string | null,
  existing: null as null | { id: string },
  created: [] as Array<Record<string, unknown>>,
}));

vi.mock("../logger.js", () => ({
  createLogger: () => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn() }),
}));

vi.mock("../db.js", () => ({
  prisma: { user: { findUnique: vi.fn(async () => (state.orgId ? { orgId: state.orgId } : null)) } },
}));

vi.mock("../repositories/index.js", () => ({
  skillRepository: {
    findBySlug: vi.fn(async () => state.existing),
    create: vi.fn(async (data: Record<string, unknown>) => {
      state.created.push(data);
      return { id: "skill-1" };
    }),
  },
}));

const { applyCreateSkill, isCreateSkillAction } = await import("./skill-apply.js");

const PARAMS = { name: "Deploy Runbook", description: "How we ship", content: "1. tag\n2. deploy" };

beforeEach(() => {
  state.orgId = "org-1";
  state.existing = null;
  state.created = [];
});

describe("isCreateSkillAction", () => {
  it("matches both signed serverTypes, so cards signed before the tool moved groups still apply", () => {
    expect(isCreateSkillAction("skill", "create-skill")).toBe(true);
    expect(isCreateSkillAction("agent-tools", "create-skill")).toBe(true);
  });

  it("does not claim other agent-tools writes", () => {
    expect(isCreateSkillAction("agent-tools", "create-agent")).toBe(false);
    expect(isCreateSkillAction("xyne-spaces", "spaces-create-ticket")).toBe(false);
  });
});

describe("applyCreateSkill", () => {
  it("creates the skill and derives a slug from the name", async () => {
    const outcome = await applyCreateSkill(PARAMS, "user-1");

    expect(outcome).toMatchObject({ status: "created", name: "Deploy Runbook", slug: "deploy-runbook" });
    expect(state.created[0]).toMatchObject({
      slug: "deploy-runbook",
      name: "Deploy Runbook",
      source: "agent-authored",
      scope: "personal",
      owner: { connect: { id: "user-1" } },
      org: { connect: { id: "org-1" } },
    });
  });

  it("keeps an explicit slug", async () => {
    const outcome = await applyCreateSkill({ ...PARAMS, slug: "runbook" }, "user-1");
    expect(outcome).toMatchObject({ status: "created", slug: "runbook" });
  });

  it("reports invalid — not duplicate — when required fields are missing", async () => {
    for (const bad of [{ ...PARAMS, name: "" }, { ...PARAMS, content: "   " }]) {
      const outcome = await applyCreateSkill(bad, "user-1");
      expect(outcome.status).toBe("invalid");
    }
    expect(state.created).toEqual([]);
  });

  it("rejects a malformed explicit slug", async () => {
    for (const slug of ["Bad Slug", "-leading", "trailing-", "double--hyphen"]) {
      const outcome = await applyCreateSkill({ ...PARAMS, slug }, "user-1");
      expect(outcome.status).toBe("invalid");
    }
    expect(state.created).toEqual([]);
  });

  it("reports invalid when the approver has no org", async () => {
    state.orgId = null;
    const outcome = await applyCreateSkill(PARAMS, "user-1");
    expect(outcome.status).toBe("invalid");
    expect(state.created).toEqual([]);
  });

  it("reports duplicate — a terminal outcome — when the slug is taken", async () => {
    state.existing = { id: "skill-existing" };
    const outcome = await applyCreateSkill(PARAMS, "user-1");
    expect(outcome).toMatchObject({ status: "duplicate" });
    expect(state.created).toEqual([]);
  });
});
