import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  run: null as { userId: string; triggerSource: string } | null,
  devices: [] as Array<{ id: string; orgId: string; deviceName: string; lastSeenAt: Date | null; focusedAt: Date | null }>,
  created: [] as Array<Record<string, unknown>>,
  answer: null as { status: string; ok: boolean; content: string; image: null } | null,
}));

vi.mock("../db.js", () => ({
  prisma: {
    agentRun: { findUnique: vi.fn(async () => db.run) },
    localHarnessDevice: { findMany: vi.fn(async () => db.devices) },
    surfaceCall: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        db.created.push(data);
        return { id: "call-1" };
      }),
      findUnique: vi.fn(async () => db.answer),
      delete: vi.fn(async () => ({})),
      update: vi.fn(async () => ({})),
    },
  },
}));

import { callSurfaceTool } from "./surface-calls.js";

const online = () => [{ id: "d1", orgId: "o1", deviceName: "mac", lastSeenAt: new Date(), focusedAt: new Date() }];

describe("browser panel tools over surface calls", () => {
  beforeEach(() => {
    db.run = null;
    db.devices = [];
    db.created = [];
    db.answer = null;
  });

  it("refuses a thread run without queueing anything", async () => {
    db.run = { userId: "u1", triggerSource: "spaces" };
    db.devices = online();
    const result = await callSurfaceTool({ userId: "u1", sessionId: "s1", toolName: "page-read", args: {} });
    expect(result.unavailable).toBe(true);
    expect(db.created).toHaveLength(0);
  });

  it("refuses a run that belongs to someone else", async () => {
    db.run = { userId: "u2", triggerSource: "chat" };
    db.devices = online();
    const result = await callSurfaceTool({ userId: "u1", sessionId: "s1", toolName: "page-read", args: {} });
    expect(result.unavailable).toBe(true);
    expect(db.created).toHaveLength(0);
  });

  it("reports unavailable when no desktop app is open", async () => {
    db.run = { userId: "u1", triggerSource: "chat" };
    const result = await callSurfaceTool({ userId: "u1", sessionId: "s1", toolName: "page-click", args: { ref: "e1" } });
    expect(result.unavailable).toBe(true);
  });

  it("queues the call for a Xyne AI screen run and returns the panel's answer", async () => {
    db.run = { userId: "u1", triggerSource: "chat" };
    db.devices = online();
    db.answer = { status: "DONE", ok: true, content: "Title: Example", image: null };
    const result = await callSurfaceTool({ userId: "u1", sessionId: "s1", toolName: "page-read", args: {} });
    expect(db.created[0]?.["toolName"]).toBe("page-read");
    expect(result).toEqual({ ok: true, content: "Title: Example" });
  });

  it("treats an old desktop app that declines page tools as unavailable", async () => {
    db.run = { userId: "u1", triggerSource: "chat" };
    db.devices = online();
    db.answer = { status: "DONE", ok: false, content: "Unknown app tool: page-read", image: null };
    const result = await callSurfaceTool({ userId: "u1", sessionId: "s1", toolName: "page-read", args: {} });
    expect(result.unavailable).toBe(true);
  });

  it("leaves app tools on thread runs as before", async () => {
    db.run = { userId: "u1", triggerSource: "spaces" };
    db.devices = online();
    db.answer = { status: "DONE", ok: true, content: "Opened", image: null };
    const result = await callSurfaceTool({ userId: "u1", sessionId: "s1", toolName: "app-navigate", args: {} });
    expect(result).toEqual({ ok: true, content: "Opened" });
  });
});
