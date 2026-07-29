import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Request } from "express";

// Mock the ACL middleware so the auth decision can be tested in isolation
// without a database. getRequesterId reads the x-user-id header; isClawAdmin
// treats a fixed set of ids as admins.
const ADMIN_IDS = new Set(["admin-1"]);
vi.mock("../middleware/agent-acl.js", () => ({
  getRequesterId: (req: Request): string | undefined => {
    const v = (req.headers?.["x-user-id"] as string | undefined) ?? undefined;
    return v && v.length > 0 ? v : undefined;
  },
  isClawAdmin: async (userId: string): Promise<boolean> =>
    ADMIN_IDS.has(userId),
}));

import { assertCanControlScheduledJob } from "./scheduled-jobs-auth.js";

type BodyShape = {
  userId?: string;
  agentSlug?: string;
  currentScheduledJobId?: string;
};

function makeReq(opts: {
  headers?: Record<string, string>;
  body?: BodyShape;
}): Request {
  return {
    headers: opts.headers ?? {},
    body: opts.body ?? {},
  } as unknown as Request;
}

const ROW = { id: "job-1", userId: "user-1", agentSlug: "doctor-agent" };

describe("assertCanControlScheduledJob", () => {
  beforeEach(() => vi.clearAllMocks());

  describe("browser session", () => {
    it("allows the owner", async () => {
      const req = makeReq({ headers: { "x-user-id": "user-1" } });
      const res = await assertCanControlScheduledJob(req, ROW);
      expect(res).toEqual({ ok: true, actorUserId: "user-1" });
    });

    it("blocks a non-owner, non-admin with 404 (no existence leak)", async () => {
      const req = makeReq({ headers: { "x-user-id": "user-2" } });
      const res = await assertCanControlScheduledJob(req, ROW);
      expect(res).toEqual({ ok: false, status: 404, error: "Not found" });
    });

    it("allows a claw admin even if not the owner", async () => {
      const req = makeReq({ headers: { "x-user-id": "admin-1" } });
      const res = await assertCanControlScheduledJob(req, ROW);
      expect(res).toEqual({ ok: true, actorUserId: "admin-1" });
    });
  });

  describe("S2S tool call", () => {
    it("rejects with 401 when userId/agentSlug are missing", async () => {
      const req = makeReq({ body: {} });
      const res = await assertCanControlScheduledJob(req, ROW);
      expect(res).toEqual({
        ok: false,
        status: 401,
        error: "Authentication required",
      });
    });

    it("allows a matching owner+agent (no currentScheduledJobId)", async () => {
      const req = makeReq({
        body: { userId: "user-1", agentSlug: "doctor-agent" },
      });
      const res = await assertCanControlScheduledJob(req, ROW);
      expect(res).toEqual({ ok: true, actorUserId: "user-1" });
    });

    it("blocks cross-user control with 404 (owner mismatch)", async () => {
      const req = makeReq({
        body: { userId: "attacker", agentSlug: "doctor-agent" },
      });
      const res = await assertCanControlScheduledJob(req, ROW);
      expect(res).toEqual({ ok: false, status: 404, error: "Not found" });
    });

    it("blocks control by a different agent with 404 (agent mismatch)", async () => {
      const req = makeReq({
        body: { userId: "user-1", agentSlug: "other-agent" },
      });
      const res = await assertCanControlScheduledJob(req, ROW);
      expect(res).toEqual({ ok: false, status: 404, error: "Not found" });
    });

    it("allows when currentScheduledJobId matches the controlled job (jobId='current')", async () => {
      const req = makeReq({
        body: {
          userId: "user-1",
          agentSlug: "doctor-agent",
          currentScheduledJobId: "job-1",
        },
      });
      const res = await assertCanControlScheduledJob(req, ROW);
      expect(res).toEqual({ ok: true, actorUserId: "user-1" });
    });

    it("blocks a scheduled run from controlling a sibling job with 403", async () => {
      // Same owner+agent, but the run belongs to job-2 and is trying to act on
      // job-1 via an arbitrary :id — must be rejected.
      const req = makeReq({
        body: {
          userId: "user-1",
          agentSlug: "doctor-agent",
          currentScheduledJobId: "job-2",
        },
      });
      const res = await assertCanControlScheduledJob(req, ROW);
      expect(res).toEqual({
        ok: false,
        status: 403,
        error: "A scheduled run may only control its own job",
      });
    });

    it("ignores an empty currentScheduledJobId string and falls back to owner+agent", async () => {
      const req = makeReq({
        body: {
          userId: "user-1",
          agentSlug: "doctor-agent",
          currentScheduledJobId: "   ",
        },
      });
      const res = await assertCanControlScheduledJob(req, ROW);
      expect(res).toEqual({ ok: true, actorUserId: "user-1" });
    });
  });
});
