import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Request, Response } from "express";

/**
 * Write access is the org-level analogue of the agent rule: creator, org
 * ADMIN/OWNER, or CLAW_ADMIN. Reads are org-wide. Anything belonging to another
 * org must read as missing (404), never as forbidden (403) — a 403 would confirm
 * the id exists.
 */

const state = vi.hoisted(() => ({
  systems: [] as Array<Record<string, any>>,
  pins: [] as Array<Record<string, any>>,
  messages: [] as Array<{ conversationId: string; userId: string }>,
  clawAdmins: new Set<string>(),
  orgAdmins: new Set<string>(),
}));

vi.mock("../repositories/designSystemRepository.js", () => ({ DESIGN_SYSTEM_MAX_CHARS: 32_000 }));

vi.mock("../repositories/index.js", () => ({
  DESIGN_SYSTEM_SOURCES: ["manual", "url", "screenshot", "repo", "file", "library"],
  chatMessageRepository: {
    findByConversation: vi.fn(async (conversationId: string) =>
      state.messages.filter((m) => m.conversationId === conversationId),
    ),
  },
  designSystemRepository: {
    listByOrg: vi.fn(async (orgId: string) => state.systems.filter((s) => s["orgId"] === orgId)),
    findById: vi.fn(
      async (id: string, orgId: string) =>
        state.systems.find((s) => s["id"] === id && s["orgId"] === orgId) ?? null,
    ),
    create: vi.fn(async (orgId: string, createdBy: string, input: Record<string, any>) => {
      const row = {
        id: `ds-${state.systems.length + 1}`,
        orgId,
        createdBy,
        version: 1,
        source: input["source"] ?? "manual",
        designMd: input["designMd"] ?? "",
        tokensCss: input["tokensCss"] ?? "",
        ...input,
      };
      state.systems.push(row);
      return row;
    }),
    update: vi.fn(async (id: string, orgId: string, input: Record<string, any>) => {
      const row = state.systems.find((s) => s["id"] === id && s["orgId"] === orgId);
      if (!row) return null;
      for (const [key, value] of Object.entries(input)) {
        if (value !== undefined) row[key] = value;
      }
      return row;
    }),
    remove: vi.fn(async (id: string, orgId: string) => {
      const index = state.systems.findIndex((s) => s["id"] === id && s["orgId"] === orgId);
      if (index < 0) return false;
      state.systems.splice(index, 1);
      return true;
    }),
    pinConversation: vi.fn(
      async (conversationId: string, designSystemId: string, orgId: string, setByUserId: string) => {
        const row = { conversationId, designSystemId, orgId, setByUserId };
        state.pins = state.pins.filter((p) => p["conversationId"] !== conversationId).concat(row);
        return row;
      },
    ),
    unpinConversation: vi.fn(async (conversationId: string) => {
      const before = state.pins.length;
      state.pins = state.pins.filter((p) => p["conversationId"] !== conversationId);
      return state.pins.length < before;
    }),
  },
}));

vi.mock("../middleware/agent-acl.js", () => ({
  getRequesterId: (req: Request) => req.headers["x-user-id"],
  getOrgId: (req: Request) => req.headers["x-org-id"],
  isClawAdmin: vi.fn(async (userId: string) => state.clawAdmins.has(userId)),
  isOrgAdmin: vi.fn(async (userId: string, orgId: string) => state.orgAdmins.has(`${userId}|${orgId}`)),
}));

vi.mock("../middleware/pin-user-id-param.js", () => ({
  getRequesterAliases: (req: Request) => [req.headers["x-user-id"]].filter(Boolean),
}));

vi.mock("../lib/audit.js", () => ({ writeAuditLog: vi.fn(async () => undefined) }));
vi.mock("../logger.js", () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

interface CallOptions {
  userId?: string | null;
  orgId?: string | null;
  body?: Record<string, unknown>;
}

async function requestJson(
  method: string,
  url: string,
  options: CallOptions = {},
): Promise<{ status: number; body: Record<string, any> }> {
  const { designSystemsRouter } = await import("./design-systems.js");
  const { HttpError } = await import("../lib/http.js");

  return await new Promise((resolve, reject) => {
    let statusCode = 200;
    const headers: Record<string, string> = {};
    if (options.userId !== null) headers["x-user-id"] = options.userId ?? "user-a";
    if (options.orgId !== null) headers["x-org-id"] = options.orgId ?? "org-1";

    const req = {
      method,
      url,
      originalUrl: url,
      headers,
      body: options.body ?? {},
      query: Object.fromEntries(new URL(url, "http://test").searchParams),
    } as unknown as Request;

    const res = {
      status(code: number) { statusCode = code; return this; },
      setHeader() { return this; },
      json(payload: Record<string, any>) { resolve({ status: statusCode, body: payload }); return this; },
    } as unknown as Response;

    (designSystemsRouter as unknown as {
      handle: (req: Request, res: Response, next: (err?: unknown) => void) => void;
    }).handle(req, res, (err?: unknown) => {
      // The bare router has no errorMiddleware mounted; mirror what it would do.
      if (err instanceof HttpError) {
        resolve({ status: err.status, body: { success: false, error: err.message } });
        return;
      }
      if (err) reject(err);
      else resolve({ status: 404, body: {} });
    });
  });
}

describe("design system route authorization", () => {
  beforeEach(() => {
    state.systems = [
      { id: "ds-1", orgId: "org-1", name: "Acme", designMd: "# Acme", tokensCss: "", createdBy: "user-a", version: 1, source: "manual" },
      { id: "ds-2", orgId: "org-2", name: "Rival", designMd: "# Rival", tokensCss: "", createdBy: "user-z", version: 1, source: "manual" },
    ];
    state.pins = [];
    state.messages = [
      { conversationId: "conv-1", userId: "user-a" },
      { conversationId: "conv-1", userId: "user-b" },
    ];
    state.clawAdmins = new Set();
    state.orgAdmins = new Set();
    vi.clearAllMocks();
  });

  it("requires an authenticated user", async () => {
    expect((await requestJson("GET", "/", { userId: null })).status).toBe(401);
  });

  it("requires org context", async () => {
    expect((await requestJson("GET", "/", { orgId: null })).status).toBe(400);
  });

  it("lists only the caller's org", async () => {
    const got = await requestJson("GET", "/", { userId: "user-b" });
    expect(got.status).toBe(200);
    expect(got.body["data"].map((s: Record<string, unknown>) => s["id"])).toEqual(["ds-1"]);
  });

  it("reads another org's system as missing, not forbidden", async () => {
    expect((await requestJson("GET", "/ds-2", { userId: "user-a" })).status).toBe(404);
  });

  it("lets any org member create, recording them as creator", async () => {
    const got = await requestJson("POST", "/", { userId: "user-b", body: { name: "New system" } });
    expect(got.status).toBe(201);
    expect(got.body["data"]).toMatchObject({ createdBy: "user-b", orgId: "org-1", source: "manual" });
  });

  it("rejects a design doc over the runtime injection cap", async () => {
    const got = await requestJson("POST", "/", {
      body: { name: "Too big", designMd: "x".repeat(32_001) },
    });
    expect(got.status).toBe(400);
  });

  it("rejects an unknown source", async () => {
    const got = await requestJson("POST", "/", { body: { name: "Bad", source: "figma" } });
    expect(got.status).toBe(400);
  });

  it("lets the creator edit their own system", async () => {
    const got = await requestJson("PATCH", "/ds-1", { userId: "user-a", body: { name: "Acme v2" } });
    expect(got.status).toBe(200);
    expect(state.systems[0]?.["name"]).toBe("Acme v2");
  });

  it("refuses an edit from another member of the same org", async () => {
    const got = await requestJson("PATCH", "/ds-1", { userId: "user-b", body: { name: "hijacked" } });
    expect(got.status).toBe(403);
    expect(state.systems[0]?.["name"]).toBe("Acme");
  });

  it("lets an org admin edit someone else's system", async () => {
    state.orgAdmins.add("user-b|org-1");
    const got = await requestJson("PATCH", "/ds-1", { userId: "user-b", body: { name: "Acme v3" } });
    expect(got.status).toBe(200);
  });

  it("lets a CLAW_ADMIN edit someone else's system", async () => {
    state.clawAdmins.add("user-c");
    const got = await requestJson("PATCH", "/ds-1", { userId: "user-c", body: { name: "Acme v4" } });
    expect(got.status).toBe(200);
  });

  it("does not let an org admin reach into another org", async () => {
    state.orgAdmins.add("user-a|org-1");
    const got = await requestJson("PATCH", "/ds-2", { userId: "user-a", body: { name: "cross-org" } });
    expect(got.status).toBe(404);
    expect(state.systems[1]?.["name"]).toBe("Rival");
  });

  it("refuses a delete from a non-creator and keeps the row", async () => {
    const got = await requestJson("DELETE", "/ds-1", { userId: "user-b" });
    expect(got.status).toBe(403);
    expect(state.systems).toHaveLength(2);
  });

  it("lets the creator delete", async () => {
    const got = await requestJson("DELETE", "/ds-1", { userId: "user-a" });
    expect(got.status).toBe(200);
    expect(state.systems.map((s) => s["id"])).toEqual(["ds-2"]);
  });

  it("lets a conversation participant pin a system", async () => {
    const got = await requestJson("PUT", "/conversations/conv-1", {
      userId: "user-b",
      body: { designSystemId: "ds-1" },
    });
    expect(got.status).toBe(200);
    expect(state.pins).toHaveLength(1);
  });

  it("hides the conversation from someone with no turn in it", async () => {
    const got = await requestJson("PUT", "/conversations/conv-1", {
      userId: "user-outsider",
      body: { designSystemId: "ds-1" },
    });
    expect(got.status).toBe(404);
    expect(state.pins).toHaveLength(0);
  });

  it("refuses to pin another org's system", async () => {
    const got = await requestJson("PUT", "/conversations/conv-1", {
      userId: "user-a",
      body: { designSystemId: "ds-2" },
    });
    expect(got.status).toBe(404);
    expect(state.pins).toHaveLength(0);
  });

  it("unpins only for a participant", async () => {
    state.pins = [{ conversationId: "conv-1", designSystemId: "ds-1", orgId: "org-1", setByUserId: "user-a" }];

    expect((await requestJson("DELETE", "/conversations/conv-1", { userId: "user-outsider" })).status).toBe(404);
    expect(state.pins).toHaveLength(1);

    expect((await requestJson("DELETE", "/conversations/conv-1", { userId: "user-b" })).status).toBe(200);
    expect(state.pins).toHaveLength(0);
  });
});

/**
 * A saved system's contrast audit (XYNE-66828). It is derived from the stored
 * token CSS on every response rather than persisted, so it cannot go stale
 * against an edited palette, and it is computed here rather than in the card so
 * the maths has one tested implementation.
 */
describe("design system contrast audit", () => {
  const FAILING_CSS =
    ":root { --brand-background: #FFFFFF; --brand-surface: #F7F7F7; --brand-text: #AAAAAA; }";
  const PASSING_CSS =
    ":root { --brand-background: #FFFFFF; --brand-surface: #F7F7F7; --brand-text: #1A1A1A; }";

  beforeEach(() => {
    state.systems = [
      { id: "ds-1", orgId: "org-1", name: "Pale", designMd: "", tokensCss: FAILING_CSS, createdBy: "user-a", version: 1, source: "url" },
      { id: "ds-3", orgId: "org-1", name: "Readable", designMd: "", tokensCss: PASSING_CSS, createdBy: "user-a", version: 1, source: "url" },
    ];
    state.pins = [];
    state.messages = [];
    state.clawAdmins = new Set();
    state.orgAdmins = new Set();
    vi.clearAllMocks();
  });

  it("flags a failing system in the list, with counts rather than every pair", async () => {
    const got = await requestJson("GET", "/");
    expect(got.status).toBe(200);
    const [failing, passing] = got.body["data"] as Array<Record<string, any>>;
    expect(failing?.["contrast"]).toEqual({ audited: 2, failing: 2, hasIssues: true });
    expect(passing?.["contrast"]["hasIssues"]).toBe(false);
    // The picker only needs the verdict; five pair results per row is payload
    // the badge never reads.
    expect(failing?.["contrast"]["pairs"]).toBeUndefined();
  });

  it("returns every pair, with a suggestion, when a single system is read", async () => {
    const got = await requestJson("GET", "/ds-1");
    expect(got.status).toBe(200);
    const audit = got.body["data"]["contrast"];
    expect(audit["hasIssues"]).toBe(true);
    expect(audit["pairs"]).toHaveLength(5);

    const body = (audit["pairs"] as Array<Record<string, any>>).find(
      (pair) => pair["id"] === "body-on-background",
    );
    expect(body?.["status"]).toBe("fail");
    expect(body?.["foregroundToken"]).toBe("brand-text");
    expect(body?.["suggestion"]["hex"]).toMatch(/^#[0-9A-F]{6}$/);
    expect(body?.["suggestion"]["ratio"]).toBeGreaterThanOrEqual(4.5);
  });

  it("audits a system as it is created, so a failing palette is flagged before it is used", async () => {
    const got = await requestJson("POST", "/", {
      body: { name: "Fresh", tokensCss: FAILING_CSS, source: "url" },
    });
    expect(got.status).toBe(201);
    expect(got.body["data"]["contrast"]["hasIssues"]).toBe(true);
  });

  it("re-audits on edit rather than carrying the verdict from before", async () => {
    const before = await requestJson("GET", "/ds-1");
    expect(before.body["data"]["contrast"]["hasIssues"]).toBe(true);

    const got = await requestJson("PATCH", "/ds-1", {
      userId: "user-a",
      body: { tokensCss: PASSING_CSS },
    });
    expect(got.status).toBe(200);
    expect(got.body["data"]["contrast"]["hasIssues"]).toBe(false);
  });

  it("saving a failing system is allowed", async () => {
    const got = await requestJson("POST", "/", {
      body: { name: "Unreadable on purpose", tokensCss: FAILING_CSS },
    });
    expect(got.status).toBe(201);
    expect(state.systems.map((s) => s["name"])).toContain("Unreadable on purpose");
  });

  describe("POST /contrast-audit", () => {
    it("requires an authenticated user", async () => {
      const got = await requestJson("POST", "/contrast-audit", {
        userId: null,
        body: { tokens: { body: "#AAAAAA", background: "#FFFFFF" } },
      });
      expect(got.status).toBe(401);
    });

    it("rejects a request with nothing to audit", async () => {
      expect((await requestJson("POST", "/contrast-audit", { body: {} })).status).toBe(400);
    });

    it("audits a palette the caller is still editing", async () => {
      const got = await requestJson("POST", "/contrast-audit", {
        body: {
          tokens: { body: "#AAAAAA", background: "#FFFFFF" },
          names: { body: "brand-text", background: "brand-background" },
        },
      });
      expect(got.status).toBe(200);
      expect(got.body["data"]["hasIssues"]).toBe(true);
      const body = (got.body["data"]["pairs"] as Array<Record<string, any>>).find(
        (pair) => pair["id"] === "body-on-background",
      );
      expect(body?.["status"]).toBe("fail");
      expect(body?.["foregroundToken"]).toBe("brand-text");
    });

    it("reports a fixed palette as clean, which is what a one-click apply checks", async () => {
      const got = await requestJson("POST", "/contrast-audit", {
        body: { tokens: { body: "#595959", background: "#FFFFFF" } },
      });
      expect(got.body["data"]["failing"]).toBe(0);
      expect(got.body["data"]["hasIssues"]).toBe(false);
    });

    it("ignores a slot it does not know instead of rejecting the whole request", async () => {
      const got = await requestJson("POST", "/contrast-audit", {
        body: { tokens: { body: "#AAAAAA", background: "#FFFFFF", sparkle: "#123456" } },
      });
      expect(got.status).toBe(200);
      expect(got.body["data"]["audited"]).toBe(1);
    });

    it("audits raw token CSS, for a system that is not saved yet", async () => {
      const got = await requestJson("POST", "/contrast-audit", {
        body: { tokensCss: FAILING_CSS },
      });
      expect(got.status).toBe(200);
      expect(got.body["data"]["hasIssues"]).toBe(true);
    });
  });
});
