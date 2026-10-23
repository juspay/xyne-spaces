import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The resolution order every caller shares: conversation pin → agent default →
 * the pre-migration `agent.config.designSystem` text. The last rung is what
 * keeps a half-finished backfill behaving like today instead of like an agent
 * with no design system, so each fallthrough is asserted explicitly.
 */

const state = vi.hoisted(() => ({
  systems: [] as Array<Record<string, any>>,
  pins: [] as Array<Record<string, any>>,
  pinLookups: 0,
  lastCreate: null as Record<string, any> | null,
  lastUpdate: null as Record<string, any> | null,
}));

vi.mock("../db.js", () => ({
  prisma: {
    designSystem: {
      findFirst: vi.fn(
        async (args: { where: { id: string; orgId: string } }) =>
          state.systems.find((s) => s["id"] === args.where.id && s["orgId"] === args.where.orgId) ?? null,
      ),
      create: vi.fn(async (args: { data: Record<string, any> }) => {
        state.lastCreate = args.data;
        return { id: "ds-new", ...args.data };
      }),
      update: vi.fn(async (args: { where: { id: string }; data: Record<string, any> }) => {
        state.lastUpdate = args.data;
        return { id: args.where.id, ...args.data };
      }),
    },
    chatConversationDesignSystem: {
      findUnique: vi.fn(async (args: { where: { conversationId: string } }) => {
        state.pinLookups += 1;
        const pin = state.pins.find((p) => p["conversationId"] === args.where.conversationId);
        if (!pin) return null;
        const designSystem = state.systems.find((s) => s["id"] === pin["designSystemId"]);
        return designSystem ? { ...pin, designSystem } : null;
      }),
    },
  },
}));

import { designSystemRepository } from "./designSystemRepository.js";

const system = (over: Record<string, unknown> = {}) => ({
  id: "ds-default",
  orgId: "org-1",
  name: "Acme",
  designMd: "# Acme",
  tokensCss: ":root{--x:1}",
  tokensCssDark: "",
  ...over,
});

const agent = (config: Record<string, unknown>) => ({ orgId: "org-1", config: config as never });

describe("designSystemRepository.resolveForAgent", () => {
  beforeEach(() => {
    state.systems = [
      system(),
      system({ id: "ds-pinned", name: "Acme Dark", designMd: "# Acme Dark" }),
      system({ id: "ds-other-org", orgId: "org-2", name: "Rival" }),
    ];
    state.pins = [];
    state.pinLookups = 0;
    vi.clearAllMocks();
  });

  it("prefers a conversation pin over the agent default", async () => {
    state.pins = [{ conversationId: "conv-1", designSystemId: "ds-pinned", orgId: "org-1" }];

    const got = await designSystemRepository.resolveForAgent(
      agent({ designSystemId: "ds-default" }),
      "conv-1",
    );

    expect(got).toMatchObject({ id: "ds-pinned", name: "Acme Dark", origin: "conversation" });
  });

  it("falls back to the agent default when the conversation has no pin", async () => {
    const got = await designSystemRepository.resolveForAgent(
      agent({ designSystemId: "ds-default" }),
      "conv-unpinned",
    );

    expect(got).toMatchObject({ id: "ds-default", origin: "agent" });
  });

  it("falls back to the legacy config text when the agent has no designSystemId", async () => {
    const got = await designSystemRepository.resolveForAgent(agent({ designSystem: "# Legacy brand" }));

    expect(got).toMatchObject({ id: null, designMd: "# Legacy brand", origin: "legacy" });
  });

  it("falls through a dangling designSystemId to the legacy text", async () => {
    const got = await designSystemRepository.resolveForAgent(
      agent({ designSystemId: "ds-deleted", designSystem: "# Legacy brand" }),
    );

    expect(got).toMatchObject({ id: null, designMd: "# Legacy brand", origin: "legacy" });
  });

  it("ignores a pin that points at another org's system", async () => {
    state.pins = [{ conversationId: "conv-1", designSystemId: "ds-other-org", orgId: "org-2" }];

    const got = await designSystemRepository.resolveForAgent(
      agent({ designSystemId: "ds-default" }),
      "conv-1",
    );

    expect(got).toMatchObject({ id: "ds-default", origin: "agent" });
  });

  it("will not resolve another org's system through the agent default", async () => {
    const got = await designSystemRepository.resolveForAgent(agent({ designSystemId: "ds-other-org" }));

    expect(got).toBeNull();
  });

  it("treats whitespace-only legacy text as absent", async () => {
    expect(await designSystemRepository.resolveForAgent(agent({ designSystem: "   \n  " }))).toBeNull();
  });

  it("returns null when the agent has no design system at all", async () => {
    expect(await designSystemRepository.resolveForAgent(agent({}))).toBeNull();
  });

  it("trims the legacy text so the runtime cap is measured on real content", async () => {
    const got = await designSystemRepository.resolveForAgent(agent({ designSystem: "  # Brand  " }));

    expect(got?.designMd).toBe("# Brand");
  });

  it("does not touch the pin table when no conversation is supplied", async () => {
    await designSystemRepository.resolveForAgent(agent({ designSystemId: "ds-default" }));

    expect(state.pinLookups).toBe(0);
  });

  it("carries the dark token set through to the resolved system", async () => {
    state.systems = [system({ id: "ds-themed", tokensCssDark: '[data-theme="dark"]{--x:2}' })];

    const got = await designSystemRepository.resolveForAgent(agent({ designSystemId: "ds-themed" }));

    expect(got).toMatchObject({
      tokensCss: ":root{--x:1}",
      tokensCssDark: '[data-theme="dark"]{--x:2}',
    });
  });

  it("resolves a single-theme system with an empty dark set, not undefined", async () => {
    const got = await designSystemRepository.resolveForAgent(agent({ designSystemId: "ds-default" }));

    expect(got?.tokensCssDark).toBe("");
  });

  it("gives the legacy text an empty dark set rather than omitting it", async () => {
    const got = await designSystemRepository.resolveForAgent(agent({ designSystem: "# Legacy" }));

    expect(got).toMatchObject({ origin: "legacy", tokensCss: "", tokensCssDark: "" });
  });
});

describe("designSystemRepository create/update — tokensCssDark", () => {
  beforeEach(() => {
    state.systems = [system({ id: "ds-1", tokensCssDark: "" })];
    state.lastCreate = null;
    state.lastUpdate = null;
    vi.clearAllMocks();
  });

  it("stores the dark set on create", async () => {
    await designSystemRepository.create("org-1", "user-1", {
      name: "Acme",
      tokensCss: ":root{--x:1}",
      tokensCssDark: '[data-theme="dark"]{--x:2}',
    });

    expect(state.lastCreate).toMatchObject({
      tokensCss: ":root{--x:1}",
      tokensCssDark: '[data-theme="dark"]{--x:2}',
    });
  });

  it("defaults the dark set to empty when a create omits it", async () => {
    await designSystemRepository.create("org-1", "user-1", { name: "Acme" });

    expect(state.lastCreate?.["tokensCssDark"]).toBe("");
  });

  it("writes the dark set and bumps the version on update", async () => {
    await designSystemRepository.update("ds-1", "org-1", {
      tokensCssDark: '[data-theme="dark"]{--x:2}',
    });

    expect(state.lastUpdate).toMatchObject({ tokensCssDark: '[data-theme="dark"]{--x:2}' });
    expect(state.lastUpdate?.["version"]).toEqual({ increment: 1 });
  });

  it("does not bump the version when the dark set is written unchanged", async () => {
    await designSystemRepository.update("ds-1", "org-1", { tokensCssDark: "" });

    expect(state.lastUpdate?.["version"]).toBeUndefined();
  });

  it("leaves the dark set untouched when an update does not mention it", async () => {
    await designSystemRepository.update("ds-1", "org-1", { name: "Renamed" });

    expect(state.lastUpdate).toMatchObject({ name: "Renamed" });
    expect(state.lastUpdate).not.toHaveProperty("tokensCssDark");
  });

  it("can clear a dark set that was previously populated", async () => {
    state.systems = [system({ id: "ds-1", tokensCssDark: '[data-theme="dark"]{--x:2}' })];

    await designSystemRepository.update("ds-1", "org-1", { tokensCssDark: "" });

    expect(state.lastUpdate).toMatchObject({ tokensCssDark: "" });
    expect(state.lastUpdate?.["version"]).toEqual({ increment: 1 });
  });
});
