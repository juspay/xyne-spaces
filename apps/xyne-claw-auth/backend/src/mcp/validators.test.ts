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

describe("spaces-create-ticket custom fields (queue-time)", () => {
  const boardFields = {
    fields: [
      { fieldName: "MID", fieldType: "STRING", required: true },
      { fieldName: "Severity", fieldType: "SINGLE_SELECT", required: false },
    ],
  };

  /** Channel exists and the app can reach it, so only the fields are judged. */
  function channelIsFine(): void {
    interact.mockResolvedValue([{ id: ticketParams.channelId }]);
    appFetch.mockResolvedValue({ ok: true });
  }

  it("names the board's real fields when the model invents one", async () => {
    channelIsFine();
    spacesFetch.mockResolvedValue(boardFields);

    const err = await validateWriteAction(
      "xyne-spaces",
      "spaces-create-ticket",
      { ...ticketParams, dynamicFields: { mid: "merchant_1234" } },
      CREDS,
    );

    expect(err).toMatch(/unknown custom field/i);
    expect(err).toContain("MID");
    expect(spacesFetch).toHaveBeenCalledWith(
      "/api/tickets/claw/board-fields?boardId=board_1",
      expect.objectContaining({ method: "GET" }),
      expect.objectContaining({ token: CREDS.token }),
    );
  });

  it("accepts the exact names", async () => {
    channelIsFine();
    spacesFetch.mockResolvedValue(boardFields);
    const err = await validateWriteAction(
      "xyne-spaces",
      "spaces-create-ticket",
      { ...ticketParams, dynamicFields: { MID: "merchant_1234" } },
      CREDS,
    );
    expect(err).toBeNull();
  });

  it("asks for a required field the model left out of a form it started", async () => {
    channelIsFine();
    spacesFetch.mockResolvedValue(boardFields);
    const err = await validateWriteAction(
      "xyne-spaces",
      "spaces-create-ticket",
      { ...ticketParams, dynamicFields: { Severity: "P2" } },
      CREDS,
    );
    expect(err).toContain("MID");
    expect(err).toMatch(/requires/i);
  });

  // Regression: an allowlist of invented type names (TEXT/DROPDOWN) matched
  // nothing, so this check silently passed for every real field. The type
  // names here are the actual FormFieldType values.
  it("demands a required STRING field, the commonest kind there is", async () => {
    channelIsFine();
    spacesFetch.mockResolvedValue({
      fields: [
        { fieldName: "MID", fieldType: "STRING", required: true },
        { fieldName: "Severity", fieldType: "SINGLE_SELECT", required: false },
      ],
    });
    const err = await validateWriteAction(
      "xyne-spaces",
      "spaces-create-ticket",
      { ...ticketParams, dynamicFields: { Severity: "P2" } },
      CREDS,
    );
    expect(err).toContain("MID");
  });

  // Type names and value shapes below are Spaces' real FormFieldType set and
  // what its write paths store, not a guess at them.
  describe("value types", () => {
    const typed = {
      fields: [
        { fieldName: "MID", fieldType: "STRING", required: false },
        { fieldName: "Amount", fieldType: "NUMBER", required: false },
        { fieldName: "Refunded", fieldType: "BOOLEAN", required: false },
        { fieldName: "Due", fieldType: "DATE", required: false },
        { fieldName: "Severity", fieldType: "SINGLE_SELECT", required: false, options: ["P1", "P2"] },
        { fieldName: "Products", fieldType: "MULTI_SELECT", required: false, options: ["UPI", "Cards"] },
        { fieldName: "Owners", fieldType: "USER", required: false },
        { fieldName: "Parent", fieldType: "TICKET", required: false },
        { fieldName: "Invoice", fieldType: "DOC", required: true },
      ],
    };

    async function create(dynamicFields: Record<string, unknown>): Promise<string | null> {
      channelIsFine();
      spacesFetch.mockResolvedValue(typed);
      return validateWriteAction("xyne-spaces", "spaces-create-ticket", { ...ticketParams, dynamicFields }, CREDS);
    }

    it("accepts each type in the shape Spaces stores it", async () => {
      await expect(
        create({
          MID: "merchant_1234",
          Amount: "499.50",
          Refunded: "true",
          Due: "2026-01-31",
          Severity: "P1",
          Products: ["UPI", "Cards"],
          Owners: ["user_1"],
          Parent: "ticket_1",
        }),
      ).resolves.toBeNull();
      await expect(create({ Amount: 499.5, Refunded: false })).resolves.toBeNull();
    });

    it.each([
      [{ MID: 1234 }, /MID must be a non-empty string/],
      [{ MID: "  " }, /MID must be a non-empty string/],
      [{ Amount: "lots" }, /Amount must be a number/],
      [{ Refunded: "yes" }, /Refunded must be true or false/],
      [{ Due: "next week" }, /Due must be a date/],
      [{ Severity: "P9" }, /Severity does not accept "P9".*P1 \| P2/],
      [{ Severity: ["P1"] }, /Severity must be a single value/],
      [{ Products: "UPI" }, /Products must be a non-empty list/],
      [{ Products: ["UPI", "Wallets"] }, /Products does not accept Wallets/],
      [{ Owners: "user_1" }, /Owners must be a non-empty list of user IDs/],
      [{ Parent: "" }, /Parent must be a ticket ID/],
      [{ Invoice: "file_1" }, /Invoice is a file field/],
    ])("refuses %j", async (dynamicFields, message) => {
      await expect(create(dynamicFields)).resolves.toMatch(message);
    });

    it("never demands a required file field, which is filled in after the ticket exists", async () => {
      await expect(create({ MID: "merchant_1234" })).resolves.toBeNull();
    });

    it("leaves a type it does not know to the Spaces API", async () => {
      channelIsFine();
      spacesFetch.mockResolvedValue({ fields: [{ fieldName: "Geo", fieldType: "LOCATION", required: false }] });
      const err = await validateWriteAction(
        "xyne-spaces",
        "spaces-create-ticket",
        { ...ticketParams, dynamicFields: { Geo: { lat: 1 } } },
        CREDS,
      );
      expect(err).toBeNull();
    });

    it("refuses a ticket-link field on an update, where Spaces has no way to store it", async () => {
      interact.mockResolvedValue([{ boardId: "board_1" }]);
      spacesFetch.mockResolvedValue(typed);
      const err = await validateWriteAction(
        "xyne-spaces",
        "spaces-update-ticket",
        { ticketId: "ticket_9", customFields: { Parent: "ticket_1" } },
        CREDS,
      );
      expect(err).toMatch(/Parent is a ticket-link field/);
    });
  });

  it("leaves a plain ticket alone — no fields passed, no form demanded", async () => {
    channelIsFine();
    const err = await validateWriteAction("xyne-spaces", "spaces-create-ticket", ticketParams, CREDS);
    expect(err).toBeNull();
    expect(spacesFetch).not.toHaveBeenCalled();
  });

  it("fails open when the board lookup breaks, rather than blocking the ticket", async () => {
    channelIsFine();
    spacesFetch.mockRejectedValue(new Error("gateway down"));
    const err = await validateWriteAction(
      "xyne-spaces",
      "spaces-create-ticket",
      { ...ticketParams, dynamicFields: { MID: "merchant_1234" } },
      CREDS,
    );
    expect(err).toBeNull();
  });
});

describe("spaces-send-ticket-email (queue-time)", () => {
  it("refuses a recipient that is not an address", async () => {
    const err = await validateWriteAction(
      "xyne-spaces",
      "spaces-send-ticket-email",
      { ticketId: "t-1", to: ["the merchant"], body: "Hello" },
      CREDS,
    );
    expect(err).toMatch(/not an email address/i);
  });

  it("refuses an empty recipient list instead of guessing one", async () => {
    const err = await validateWriteAction(
      "xyne-spaces",
      "spaces-send-ticket-email",
      { ticketId: "t-1", to: [], body: "Hello" },
      CREDS,
    );
    expect(err).toMatch(/recipient/i);
  });

  it("rejects a ticket that does not exist before anyone approves the send", async () => {
    interact.mockResolvedValue([]);
    const err = await validateWriteAction(
      "xyne-spaces",
      "spaces-send-ticket-email",
      { ticketId: "nope", to: ["ops@merchant.com"], body: "Hello" },
      CREDS,
    );
    expect(err).toMatch(/no ticket found/i);
  });

  it("passes a real ticket on an email desk through", async () => {
    interact
      .mockResolvedValueOnce([{ id: "t-1", conversationId: "conv-1", channelId: "chan-1" }])
      .mockResolvedValueOnce([{ name: "f2program-desk", type: "EMAIL" }]);
    const err = await validateWriteAction(
      "xyne-spaces",
      "spaces-send-ticket-email",
      { ticketId: "t-1", to: ["ops@merchant.com"], body: "Hello" },
      CREDS,
    );
    expect(err).toBeNull();
  });

  // An app desk has no mailbox. Before this check the send queued, the person
  // approved it, and the Spaces email route's 404 came back relabelled as
  // "target conversation not found — re-run the agent".
  it("refuses a ticket on an app desk, naming the real reason", async () => {
    interact
      .mockResolvedValueOnce([{ id: "t-1", conversationId: "conv-1", channelId: "chan-1" }])
      .mockResolvedValueOnce([{ name: "test-app-2", type: "APP" }]);
    const err = await validateWriteAction(
      "xyne-spaces",
      "spaces-send-ticket-email",
      { ticketId: "t-1", to: ["ops@merchant.com"], body: "Hello" },
      CREDS,
    );
    expect(err).toContain("#test-app-2");
    expect(err).toMatch(/app desk/i);
    expect(err).toMatch(/no mailbox/i);
  });

  it("still sends when the channel lookup breaks — the API stays the judge", async () => {
    interact
      .mockResolvedValueOnce([{ id: "t-1", conversationId: "conv-1", channelId: "chan-1" }])
      .mockRejectedValueOnce(new Error("gateway down"));
    const err = await validateWriteAction(
      "xyne-spaces",
      "spaces-send-ticket-email",
      { ticketId: "t-1", to: ["ops@merchant.com"], body: "Hello" },
      CREDS,
    );
    expect(err).toBeNull();
  });
});
