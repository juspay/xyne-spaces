import { beforeEach, describe, expect, it, vi } from "vitest";

class FakeSpacesApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

const store = new Map<string, string>();
const redis = {
  get: vi.fn(async (key: string) => store.get(key) ?? null),
  set: vi.fn(async (key: string, value: string, ...args: unknown[]) => {
    if (args.includes("NX") && store.has(key)) return null;
    store.set(key, value);
    return "OK";
  }),
  del: vi.fn(async (key: string) => (store.delete(key) ? 1 : 0)),
};
const runs: Array<{ status: string; completedAt: Date | null; startedAt: Date; error: string | null }> = [];
const findMany = vi.fn(async () => runs);
let nextId = 0;
const spacesAppFetch = vi.fn(async (path: string, body: Record<string, unknown>): Promise<unknown> => {
  if (path === "/chat/postMessage") {
    nextId += 1;
    return body["conversationId"]
      ? { messageId: `reply-${nextId}`, conversationId: body["conversationId"] }
      : { messageId: `card-${nextId}`, conversationId: `thread-${nextId}` };
  }
  return {};
});
const spacesAppFetchMultipart = vi.fn(async (_path: string, _form: FormData): Promise<unknown> => ({ messageId: "file-reply" }));

vi.mock("../redis.js", () => ({ redisService: { getConnection: () => redis } }));
vi.mock("../db.js", () => ({ prisma: { scheduledJobRun: { findMany } } }));
vi.mock("../config.js", () => ({ CONFIG: { spacesAppUrl: "https://spaces.example.com/" } }));
vi.mock("../logger.js", () => ({ createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }) }));
vi.mock("./spaces-api.js", () => ({ SpacesApiError: FakeSpacesApiError, spacesAppFetch, spacesAppFetchMultipart }));

const { deliverToJobThread, formatCardTime, jobCardText, jobThreadMessageUrl } = await import("./scheduled-job-card.js");

const target = { jobId: "job-1", channelId: "ch-1", workspaceId: "ws-1", spacesAppUserId: "bot-1", appToken: "tok" };
const job = { label: "Pokémon of the day", task: "Post a Pokémon", nextRunAt: new Date("2026-10-24T09:00:00Z") };

const calls = (path: string): Array<Record<string, unknown>> =>
  spacesAppFetch.mock.calls.filter(([p]) => p === path).map(([, body]) => body);

function addRun(status: string, iso: string, error: string | null = null): void {
  runs.unshift({ status, completedAt: new Date(iso), startedAt: new Date(iso), error });
}

describe("scheduled job card", () => {
  beforeEach(() => {
    store.clear();
    runs.length = 0;
    nextId = 0;
    vi.clearAllMocks();
  });

  it("formats times in UTC and links straight to a reply in the job thread", () => {
    expect(formatCardTime(new Date("2026-10-23T04:05:00Z"))).toBe("23 Oct, 04:05 UTC");
    expect(jobThreadMessageUrl("ch 1", "thread-1", "reply-2")).toBe(
      "https://spaces.example.com/chat/dir/ch%201/thread-1#origin=thread-1&messageId=reply-2",
    );
  });

  it("shows the last run, next run, recent history and the latest output", () => {
    const text = jobCardText({
      name: "Pokémon of the day",
      history: [
        { status: "completed", at: new Date("2026-10-23T09:00:00Z") },
        { status: "failed", at: new Date("2026-10-22T09:00:00Z"), error: "boom" },
      ],
      nextRunAt: new Date("2026-10-24T09:00:00Z"),
      latestOutputUrl: "https://x/y",
    });
    expect(text).toBe(
      [
        "**🗓 Pokémon of the day** · scheduled job",
        "",
        "- Last run: ✅ Succeeded · 23 Oct, 09:00 UTC",
        "- Next run: 24 Oct, 09:00 UTC",
        "- Recent: ✅ 23 Oct, 09:00 · ❌ 22 Oct, 09:00",
        "",
        "[Latest output](https://x/y) · _Each run replies in this thread._",
      ].join("\n"),
    );
  });

  it("puts a short, single-line failure reason on the card", () => {
    const text = jobCardText({
      name: "Digest",
      history: [{ status: "failed", at: new Date("2026-10-23T09:00:00Z"), error: `quota\n${"x".repeat(300)}` }],
      nextRunAt: null,
      latestOutputUrl: null,
    });
    expect(text).toContain("Last run: ❌ Failed · 23 Oct, 09:00 UTC — quota x");
    expect(text).toContain("Next run: —");
    expect(text.split("\n")[2]!.length).toBeLessThan(220);
    expect(text).not.toContain("Recent:");
  });

  it("starts one thread for the job, replies in it on every run and keeps the card up to date", async () => {
    addRun("completed", "2026-10-21T09:00:00Z");
    await deliverToJobThread(target, job, { kind: "output", markdownText: "Run 1" });
    addRun("completed", "2026-10-22T09:00:00Z");
    await deliverToJobThread(target, job, { kind: "output", markdownText: "Run 2" });
    addRun("completed", "2026-10-23T09:00:00Z");
    await deliverToJobThread(target, job, { kind: "output", markdownText: "Run 3" });

    const posts = calls("/chat/postMessage");
    expect(posts.filter((b) => !b["conversationId"])).toHaveLength(1);
    expect(posts.filter((b) => b["conversationId"] === "thread-1").map((b) => b["markdownText"])).toEqual(["Run 1", "Run 2", "Run 3"]);

    const edits = calls("/chat/updateMessage");
    expect(edits).toHaveLength(3);
    expect(edits.every((b) => b["messageId"] === "card-1")).toBe(true);
    const last = String(edits[2]!["markdownText"]);
    expect(last).toContain("Last run: ✅ Succeeded · 23 Oct, 09:00 UTC");
    expect(last).toContain("Recent: ✅ 23 Oct, 09:00 · ✅ 22 Oct, 09:00 · ✅ 21 Oct, 09:00");
    expect(last).toContain("messageId=reply-4");
  });

  it("edits the card on a failure instead of posting into the channel", async () => {
    addRun("completed", "2026-10-22T09:00:00Z");
    await deliverToJobThread(target, job, { kind: "output", markdownText: "Run 1" });
    addRun("failed", "2026-10-23T09:00:00Z", "model timed out");
    await deliverToJobThread(target, job, { kind: "failure", error: "model timed out" });

    expect(calls("/chat/postMessage")).toHaveLength(2);
    const last = String(calls("/chat/updateMessage").at(-1)!["markdownText"]);
    expect(last).toContain("Last run: ❌ Failed · 23 Oct, 09:00 UTC — model timed out");
    expect(last).toContain("messageId=reply-2");
  });

  it("starts a new card when the job now posts to a different channel", async () => {
    addRun("completed", "2026-10-22T09:00:00Z");
    await deliverToJobThread(target, job, { kind: "output", markdownText: "Run 1" });
    await deliverToJobThread({ ...target, channelId: "ch-2" }, job, { kind: "output", markdownText: "Run 2" });

    const cards = calls("/chat/postMessage").filter((b) => !b["conversationId"]);
    expect(cards.map((b) => b["channelId"])).toEqual(["ch-1", "ch-2"]);
  });

  it("starts a new card and retries once when the old thread is gone", async () => {
    addRun("completed", "2026-10-22T09:00:00Z");
    await deliverToJobThread(target, job, { kind: "output", markdownText: "Run 1" });
    spacesAppFetch.mockImplementationOnce(async () => {
      throw new FakeSpacesApiError(404, "conversation not found");
    });
    await deliverToJobThread(target, job, { kind: "output", markdownText: "Run 2" });

    const posts = calls("/chat/postMessage");
    expect(posts.filter((b) => !b["conversationId"])).toHaveLength(2);
    expect(posts.at(-1)).toMatchObject({ markdownText: "Run 2", conversationId: "thread-3" });
  });

  it("uploads attachments into the job thread", async () => {
    addRun("completed", "2026-10-22T09:00:00Z");
    await deliverToJobThread(target, job, {
      kind: "output",
      markdownText: "Chart",
      attachments: [{ fileName: "a.png", mimeType: "image/png", data: Buffer.from("x").toString("base64") }],
    });
    const form = spacesAppFetchMultipart.mock.calls[0]![1];
    expect(form.get("conversationId")).toBe("thread-1");
    expect(form.get("channelId")).toBe("ch-1");
    expect(String(calls("/chat/updateMessage")[0]!["markdownText"])).toContain("messageId=file-reply");
  });

  it("keeps working when Redis is down, posting a fresh card", async () => {
    redis.get.mockRejectedValueOnce(new Error("redis down"));
    addRun("completed", "2026-10-22T09:00:00Z");
    await expect(deliverToJobThread(target, job, { kind: "output", markdownText: "Run 1" })).resolves.toBeUndefined();
    expect(calls("/chat/postMessage")).toHaveLength(2);
  });
});
