import { afterEach, describe, expect, it, vi } from "vitest";
import { listScheduledJobs, scheduledJobControl } from "./tools.js";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const baseOpts = {
  authUrl: "http://auth",
  s2sKey: "k",
  userId: "u1",
  agentSlug: "claw",
  includeInactive: false,
};

describe("listScheduledJobs", () => {
  it("scopes the request to the user + agent and sends the S2S key", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ success: true, data: [] }));
    await listScheduledJobs({ ...baseOpts, fetchImpl: fetchImpl as unknown as typeof fetch });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("http://auth/claw/api/v1/scheduled-jobs?userId=u1&agentSlug=claw");
    expect(init.method).toBe("GET");
    expect((init.headers as Record<string, string>)["x-s2s-key"]).toBe("k");
  });

  it("returns job ids and hides cancelled/completed jobs by default", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        success: true,
        data: [
          { id: "job_active", label: "Sneakers alert", type: "cron", status: "active", cronExpression: "*/30 * * * *", task: "check mail for sneakers" },
          { id: "job_paused", label: "Digest", type: "once", status: "paused" },
          { id: "job_done", label: "Old", type: "once", status: "completed" },
          { id: "job_cancelled", label: "Gone", type: "cron", status: "cancelled" },
        ],
      }),
    );
    const out = await listScheduledJobs({ ...baseOpts, fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(out).toContain("jobId: job_active");
    expect(out).toContain("Sneakers alert");
    expect(out).toContain("jobId: job_paused");
    expect(out).not.toContain("job_done");
    expect(out).not.toContain("job_cancelled");
  });

  it("includes inactive jobs when asked", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ success: true, data: [{ id: "job_cancelled", status: "cancelled", type: "cron" }] }),
    );
    const out = await listScheduledJobs({ ...baseOpts, includeInactive: true, fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(out).toContain("jobId: job_cancelled");
  });

  it("says so when there is nothing to list", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ success: true, data: [] }));
    const out = await listScheduledJobs({ ...baseOpts, fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(out).toMatch(/No active or paused scheduled jobs/);
  });

  it("surfaces the upstream error", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ success: false, error: "Authentication required" }, 401));
    const out = await listScheduledJobs({ ...baseOpts, fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(out).toBe("Error: Failed to list scheduled jobs: Authentication required");
  });
});

describe("scheduledJobControl action='list'", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("does not require jobId and lists via GET", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({ success: true, data: [{ id: "job_1", label: "Sneakers", type: "cron", status: "active" }] }),
    );
    vi.stubGlobal("fetch", fetchMock);
    expect(scheduledJobControl.inputSchema.required).toEqual(["action"]);
    const out = await scheduledJobControl.execute(
      { action: "list" },
      { meta: { userId: "u1", agentSlug: "claw" }, config: { XYNE_CLAW_AUTH_URL: "http://auth" } } as never,
    );
    expect(out).toContain("jobId: job_1");
    const [url] = fetchMock.mock.calls[0] as unknown as [string];
    expect(url).toContain("/claw/api/v1/scheduled-jobs?userId=u1&agentSlug=claw");
  });

  it("still requires jobId for mutating actions", async () => {
    const out = await scheduledJobControl.execute(
      { action: "cancel" },
      { meta: { userId: "u1", agentSlug: "claw" }, config: {} } as never,
    );
    expect(out).toBe("Error: jobId is required.");
  });
});
