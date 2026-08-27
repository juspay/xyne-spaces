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
