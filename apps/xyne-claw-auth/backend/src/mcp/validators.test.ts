import { afterEach, describe, expect, it, vi } from "vitest";

// Mock the Spaces client so validateWriteAction's target checks are driven from
// the test: `interact` decides channel EXISTENCE, `appFetch` decides app
// MEMBERSHIP (the /api/apps/channel/info access call the card path also makes).
const interact = vi.fn();
const appFetch = vi.fn();
const spacesFetch = vi.fn();
vi.mock("./servers/xyne-spaces-client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./servers/xyne-spaces-client.js")>();
  return {
    ...actual, // keep the real SpacesApiError so `instanceof` matches in validators.ts
    interact: (...args: unknown[]) => interact(...args),
    appFetch: (...args: unknown[]) => appFetch(...args),
    spacesFetch: (...args: unknown[]) => spacesFetch(...args),
  };
});

const spacesConversationExists = vi.fn(async (_id: string) => null as boolean | null);
vi.mock("../lib/spaces-post-target.js", () => ({
  spacesConversationExists: (id: string) => spacesConversationExists(id),
}));

const { validateWriteAction } = await import("./validators.js");
const { SpacesApiError } = await import("./servers/xyne-spaces-client.js");

const CREDS = { token: "app.jwt.token", url: "https://spaces.example" };
const ticketParams = {
  title: "Breeze migration",
  description: "Migration work",
  projectId: "proj_1",
  boardId: "board_1",
  channelId: "cmp286drb0747143o84js8ued",
};

afterEach(() => {
  spacesConversationExists.mockReset();
  spacesConversationExists.mockResolvedValue(null);
  interact.mockReset();
  appFetch.mockReset();
  spacesFetch.mockReset();
});

describe("spaces-create-ticket target channel access (queue-time)", () => {
  it("rejects a channel the app is not a member of, so it never queues", async () => {
    interact.mockResolvedValue([{ id: ticketParams.channelId }]); // channel EXISTS
    appFetch.mockRejectedValue(new SpacesApiError(403, "Spaces app API 403: forbidden")); // app NOT a member

    const err = await validateWriteAction("xyne-spaces", "spaces-create-ticket", ticketParams, CREDS);

    expect(err).toMatch(/not accessible/i);
    expect(appFetch).toHaveBeenCalledWith(
      "/channel/info",
      expect.objectContaining({ method: "POST" }),
      expect.objectContaining({ token: CREDS.token }),
    );
  });

  it("allows a channel the app can reach (nothing to correct)", async () => {
    interact.mockResolvedValue([{ id: ticketParams.channelId }]);
    appFetch.mockResolvedValue({ name: "consumer-credit" }); // app IS a member

    const err = await validateWriteAction("xyne-spaces", "spaces-create-ticket", ticketParams, CREDS);

    expect(err).toBeNull();
  });

  it("rejects a non-existent channel before ever calling the access endpoint", async () => {
    interact.mockResolvedValue([]); // definitively not found

    const err = await validateWriteAction("xyne-spaces", "spaces-create-ticket", ticketParams, CREDS);

    expect(err).toMatch(/not found/i);
    expect(appFetch).not.toHaveBeenCalled();
  });

  it("fails OPEN on a non-403/404 access error (Spaces API stays the judge)", async () => {
    interact.mockResolvedValue([{ id: ticketParams.channelId }]);
    appFetch.mockRejectedValue(new SpacesApiError(500, "Spaces app API 500: upstream"));

    const err = await validateWriteAction("xyne-spaces", "spaces-create-ticket", ticketParams, CREDS);

    expect(err).toBeNull();
  });

  it("still enforces required fields before any target check", async () => {
    const err = await validateWriteAction(
      "xyne-spaces",
      "spaces-create-ticket",
      { ...ticketParams, title: "" },
      CREDS,
    );
    expect(err).toBe("title is required");
    expect(interact).not.toHaveBeenCalled();
    expect(appFetch).not.toHaveBeenCalled();
  });
});

describe("user-send-message target conversation (queue-time)", () => {
  const reply = { conversationId: "eed03881-3c10-4365-9a95-7a2c5f973844", content: "hi" };

  it("accepts a conversation the Spaces DB has, whatever its id format, without the HTTP probe", async () => {
    spacesConversationExists.mockResolvedValue(true);
    spacesFetch.mockRejectedValue(new SpacesApiError(404, "Spaces API 404: not found"));
    await expect(validateWriteAction("xyne-spaces", "user-send-message", reply, CREDS)).resolves.toBeNull();
    expect(spacesFetch).not.toHaveBeenCalled();
  });

  it("falls back to the HTTP probe when the DB does not have it or is unavailable", async () => {
    for (const dbAnswer of [false, null]) {
      spacesConversationExists.mockResolvedValue(dbAnswer);
      spacesFetch.mockRejectedValueOnce(new SpacesApiError(404, "Spaces API 404: not found"));
      await expect(validateWriteAction("xyne-spaces", "user-send-message", reply, CREDS)).resolves.toMatch(/not found/);
    }
  });
});

describe("user-send-message target validation", () => {
  const userId = "user_123";
  const token = [
    Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url"),
    Buffer.from(JSON.stringify({ sub: userId })).toString("base64url"),
    "signature",
  ].join(".");
  const userCreds = { token, url: "https://spaces.example" };
  const channelId = "channel_private_dm";

  it("uses the invoking user's membership and does not require app access", async () => {
    interact
      .mockResolvedValueOnce([{ id: channelId }])
      .mockResolvedValueOnce([{ channelId, userId }]);

    const error = await validateWriteAction(
      "xyne-spaces",
      "user-send-message",
      { channelId, content: "hello" },
      userCreds,
    );

    expect(error).toBeNull();
    expect(interact).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        model: "channelParticipant",
        where: { channelId: { equals: channelId }, userId: { equals: userId } },
      }),
      expect.objectContaining({ token }),
    );
    expect(appFetch).not.toHaveBeenCalled();
  });

  it("rejects a channel when the invoking user is not a member", async () => {
    interact
      .mockResolvedValueOnce([{ id: channelId }])
      .mockResolvedValueOnce([]);

    const error = await validateWriteAction(
      "xyne-spaces",
      "user-send-message",
      { channelId, content: "hello" },
      userCreds,
    );

    expect(error).toMatch(/must be a member/i);
    expect(appFetch).not.toHaveBeenCalled();
  });

  it("accepts recipientUserId as an exclusive DM target without app validation", async () => {
    const error = await validateWriteAction(
      "xyne-spaces",
      "user-send-message",
      { recipientUserId: "recipient_456", content: "hello" },
      userCreds,
    );

    expect(error).toBeNull();
    expect(interact).not.toHaveBeenCalled();
    expect(appFetch).not.toHaveBeenCalled();
  });

  it("rejects multiple targets", async () => {
    const error = await validateWriteAction(
      "xyne-spaces",
      "user-send-message",
      { channelId, recipientUserId: "recipient_456", content: "hello" },
      userCreds,
    );

    expect(error).toMatch(/exactly one target/i);
    expect(interact).not.toHaveBeenCalled();
  });
});
