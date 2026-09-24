import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  interact: vi.fn(),
  spacesFetchBuffer: vi.fn(),
  spacesFetch: vi.fn(),
  spacesFetchText: vi.fn(),
  search: vi.fn(),
  memorySearch: vi.fn(),
  appFetch: vi.fn(),
}));

vi.mock("./xyne-spaces-client.js", () => mocks);

process.env["ENCRYPTION_KEY"] ||= "00".repeat(32);
process.env["XYNE_CLAW_URL"] = "http://claw.local";
process.env["XYNE_CLAW_S2S_KEY"] = "s2s-secret";

type InteractParams = { model: string };

function mockModels(map: Record<string, unknown>) {
  mocks.interact.mockImplementation(async (params: InteractParams) => map[params.model] ?? []);
}

async function loadTool(name: string) {
  const mod = await import("./xyne-spaces-tools.js");
  const tool = mod.tools.find((t) => t.name === name);
  if (!tool) throw new Error(`${name} tool not found`);
  return tool;
}

const ctx = { userId: "u1", authMode: "user" as const };

beforeEach(() => {
  vi.clearAllMocks();
});

describe("spaces-projects", () => {
  it("lists projects", async () => {
    mockModels({
      project: [
        {
          id: "proj-1",
          name: "Project Alpha",
          code: "ALPHA",
          description: "Core platform migration",
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-05T00:00:00.000Z",
        },
        {
          id: "proj-2",
          name: "Project Beta",
          code: "BETA",
          createdAt: "2026-02-01T00:00:00.000Z",
          updatedAt: "2026-02-10T00:00:00.000Z",
        },
      ],
    });

    const tool = await loadTool("spaces-projects");
    const result = await tool.handler({ limit: 10 }, ctx);
    const text = result.content[0]?.text ?? "";

    expect(result.isError).toBeUndefined();
    expect(text).toMatchInlineSnapshot(`
      "2 project(s):

      [clf-__TOOL_CALL_ID__#1] Project Alpha [ALPHA]
        Core platform migration
        ID: proj-1
        Updated: 5/1/2026, 5:30:00 am

      [clf-__TOOL_CALL_ID__#2] Project Beta [BETA]
        ID: proj-2
        Updated: 10/2/2026, 5:30:00 am"
    `);
  });

  it("returns a no-results message when empty", async () => {
    mockModels({ project: [] });
    const tool = await loadTool("spaces-projects");
    const result = await tool.handler({}, ctx);
    const text = result.content[0]?.text ?? "";

    expect(result.isError).toBeUndefined();
    expect(text).toMatchInlineSnapshot(`"No projects found."`);
  });
});

describe("spaces-boards", () => {
  it("lists boards", async () => {
    mockModels({
      board: [
        {
          id: "board-1",
          name: "Sprint Board",
          description: "Active sprint tracking",
          projectId: "proj-1",
          project: { name: "Project Alpha" },
          updatedAt: "2026-03-01T00:00:00.000Z",
        },
        {
          id: "board-2",
          name: "Backlog",
          project: { name: "Project Alpha" },
          updatedAt: "2026-03-05T00:00:00.000Z",
        },
      ],
    });

    const tool = await loadTool("spaces-boards");
    const result = await tool.handler({ limit: 10 }, ctx);
    const text = result.content[0]?.text ?? "";

    expect(result.isError).toBeUndefined();
    expect(text).toMatchInlineSnapshot(`
      "2 board(s):

      Sprint Board
        Active sprint tracking
        Project: Project Alpha
        ID: board-1
        Updated: 1/3/2026, 5:30:00 am

      Backlog
        Project: Project Alpha
        ID: board-2
        Updated: 5/3/2026, 5:30:00 am"
    `);
  });

  it("returns a no-results message when empty", async () => {
    mockModels({ board: [] });
    const tool = await loadTool("spaces-boards");
    const result = await tool.handler({}, ctx);
    const text = result.content[0]?.text ?? "";

    expect(result.isError).toBeUndefined();
    expect(text).toMatchInlineSnapshot(`"No boards found."`);
  });
});

describe("spaces-channels", () => {
  it("lists channels", async () => {
    mockModels({
      channel: [
        {
          id: "chan-1",
          name: "general",
          description: "Company-wide announcements",
          type: "DEFAULT",
          scopeType: "DEFAULT",
          visibility: "PUBLIC",
          participantCount: 0,
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-10T00:00:00.000Z",
          lastActivityAt: "2026-01-15T00:00:00.000Z",
          createdBy: "user-1",
          isArchived: false,
          project: { name: "Project Alpha" },
        },
        {
          id: "chan-2",
          name: "eng-team",
          type: "DEFAULT",
          scopeType: "DEFAULT",
          visibility: "PRIVATE",
          participantCount: 0,
          createdAt: "2026-02-01T00:00:00.000Z",
          updatedAt: "2026-02-10T00:00:00.000Z",
          lastActivityAt: "2026-02-12T00:00:00.000Z",
          createdBy: "user-2",
          isArchived: false,
        },
      ],
      channelParticipant: [
        { channelId: "chan-1", userId: "user-1" },
        { channelId: "chan-1", userId: "user-2" },
        { channelId: "chan-2", userId: "user-2" },
      ],
      user: [
        { id: "user-1", name: "Asha Rao", email: "asha@example.com" },
        { id: "user-2", name: "Ravi Kumar", email: "ravi@example.com" },
      ],
      conversation: [{ conversationId: "conv-1", channelId: "chan-1", lastActivityAt: "2026-01-15T00:00:00.000Z" }],
    });

    const tool = await loadTool("spaces-channels");
    const result = await tool.handler({ limit: 10 }, ctx);
    const text = result.content[0]?.text ?? "";

    expect(result.isError).toBeUndefined();
    expect(text).toMatchInlineSnapshot(`
      "2 channel(s):

      [clf-__TOOL_CALL_ID__#1] #general (id: chan-1) (DEFAULT, PUBLIC)
        Company-wide announcements
        Members: 2
        Created by: Asha Rao <asha@example.com> (id: user-1)
        Project: Project Alpha
        Created: 1/1/2026, 5:30:00 am IST · Updated: 10/1/2026, 5:30:00 am IST · Last active: 15/1/2026, 5:30:00 am IST
        Latest thread ConversationID: conv-1
        ID: chan-1

      [clf-__TOOL_CALL_ID__#2] #eng-team (id: chan-2) (DEFAULT, PRIVATE)
        Members: 1
        Created by: Ravi Kumar <ravi@example.com> (id: user-2)
        Created: 1/2/2026, 5:30:00 am IST · Updated: 10/2/2026, 5:30:00 am IST · Last active: 12/2/2026, 5:30:00 am IST
        ID: chan-2"
    `);
  });

  it("returns a no-results message when empty", async () => {
    mockModels({ channel: [] });
    const tool = await loadTool("spaces-channels");
    const result = await tool.handler({}, ctx);
    const text = result.content[0]?.text ?? "";

    expect(result.isError).toBeUndefined();
    expect(text).toMatchInlineSnapshot(`"No channels found."`);
  });
});

describe("spaces-users", () => {
  it("lists users matching a name", async () => {
    mockModels({
      user: [
        {
          id: "user-1",
          name: "Asha Rao",
          email: "asha@example.com",
          status: "ACTIVE",
          userType: "MEMBER",
          role: "Engineer",
          createdAt: "2025-06-01T00:00:00.000Z",
          lastActiveAt: "2026-08-01T00:00:00.000Z",
        },
        {
          id: "user-2",
          name: "Asha Mehta",
          email: "asha.mehta@example.com",
          status: "INACTIVE",
          userType: "MEMBER",
          leftAt: "2026-05-01T00:00:00.000Z",
        },
      ],
    });

    const tool = await loadTool("spaces-users");
    const result = await tool.handler({ nameOrEmail: "Asha" }, ctx);
    const text = result.content[0]?.text ?? "";

    expect(result.isError).toBeUndefined();
    expect(text).toMatchInlineSnapshot(`
      "2 user(s):

      [clf-__TOOL_CALL_ID__#1] Asha Rao <asha@example.com> — MEMBER
        Role: Engineer · ID: user-1
        Joined: 1/6/2025, 5:30:00 am IST · Last seen: 1/8/2026, 5:30:00 am IST

      [clf-__TOOL_CALL_ID__#2] Asha Mehta <asha.mehta@example.com> — MEMBER [INACTIVE, left 5/1/2026]
        ID: user-2"
    `);
  });

  it("returns a no-results message when empty", async () => {
    mockModels({ user: [] });
    const tool = await loadTool("spaces-users");
    const result = await tool.handler({ nameOrEmail: "nobody" }, ctx);
    const text = result.content[0]?.text ?? "";

    expect(result.isError).toBeUndefined();
    expect(text).toMatchInlineSnapshot(`"No users found matching "nobody"."`);
  });
});

describe("spaces-canvases", () => {
  it("lists canvases", async () => {
    mockModels({
      canvas: [
        {
          id: "canvas-1",
          title: "Q3 Roadmap",
          docType: "DOC",
          visibility: "PUBLIC",
          channelId: "chan-1",
          createdBy: "user-1",
          lastEditedAt: "2026-03-01T00:00:00.000Z",
          viewAccessId: "view-1",
        },
        {
          id: "canvas-2",
          title: "Design Review Slides",
          docType: "SLIDES",
          visibility: "PRIVATE",
          updatedAt: "2026-03-05T00:00:00.000Z",
        },
      ],
    });

    const tool = await loadTool("spaces-canvases");
    const result = await tool.handler({ limit: 10 }, ctx);
    const text = result.content[0]?.text ?? "";

    expect(result.isError).toBeUndefined();
    expect(text).toMatchInlineSnapshot(`
      "2 canvas(es):

      [clf-__TOOL_CALL_ID__#1] Q3 Roadmap
        Type: DOC · Visibility: PUBLIC
        ChannelID: chan-1
        Created by: user-1
        Last edited: 1/3/2026, 5:30:00 am
        ID: canvas-1

      [clf-__TOOL_CALL_ID__#2] Design Review Slides
        Type: SLIDES · Visibility: PRIVATE
        Updated: 5/3/2026, 5:30:00 am
        ID: canvas-2"
    `);
  });

  it("returns a no-results message when empty", async () => {
    mockModels({ canvas: [] });
    const tool = await loadTool("spaces-canvases");
    const result = await tool.handler({}, ctx);
    const text = result.content[0]?.text ?? "";

    expect(result.isError).toBeUndefined();
    expect(text).toMatchInlineSnapshot(`"No canvases found."`);
  });
});

describe("spaces-calls", () => {
  it("lists calls", async () => {
    mockModels({
      call: [
        {
          id: "call-1",
          externalId: "ext-1",
          title: "Weekly Sync",
          callType: "VIDEO",
          status: "ENDED",
          channelId: "chan-1",
          organizerId: "user-1",
          createdByUserId: "user-1",
          aiSummary: "Discussed Q3 roadmap and blockers.",
          transcript: "storage://transcript-1",
          startsAt: "2026-04-01T09:00:00.000Z",
          endsAt: "2026-04-01T09:30:00.000Z",
          metadata: { conversationId: "conv-1" },
        },
      ],
      callParticipant: [
        { callId: "call-1", userId: "user-1", response: "ACCEPTED" },
        { callId: "call-1", userId: "user-2", response: "ACCEPTED" },
      ],
      user: [
        { id: "user-1", name: "Asha Rao", email: "asha@example.com" },
        { id: "user-2", name: "Ravi Kumar", email: "ravi@example.com" },
      ],
      channel: [{ id: "chan-1", name: "general", scopeType: "DEFAULT", type: "DEFAULT" }],
    });

    const tool = await loadTool("spaces-calls");
    const result = await tool.handler({ limit: 10 }, ctx);
    const text = result.content[0]?.text ?? "";

    expect(result.isError).toBeUndefined();
    expect(text).toMatchInlineSnapshot(`
      "1 call(s):

      [clf-__TOOL_CALL_ID__#1] Weekly Sync
        Type: VIDEO · Status: ENDED
        ChannelID: chan-1
        Organizer: Asha Rao <asha@example.com> (id: user-1)
        Starts: 1/4/2026, 2:30:00 pm
        Ends: 1/4/2026, 3:00:00 pm
        Participants (2): Asha Rao [ACCEPTED], Ravi Kumar [ACCEPTED]
        Summary: Discussed Q3 roadmap and blockers.
        Transcript: available — re-run with callId=call-1, includeTranscript=true to read it in full
        ID: call-1"
    `);
  });

  it("returns a no-results message when empty", async () => {
    mockModels({ call: [] });
    const tool = await loadTool("spaces-calls");
    const result = await tool.handler({}, ctx);
    const text = result.content[0]?.text ?? "";

    expect(result.isError).toBeUndefined();
    expect(text).toMatchInlineSnapshot(`"No calls found."`);
  });
});

describe("spaces-tickets", () => {
  it("lists tickets", async () => {
    mockModels({
      ticket: [
        {
          id: "ticket-1",
          xyneId: "XYNE-101",
          title: "Login fails on SSO",
          statusV2: "STARTED",
          priority: "HIGH",
          stageName: "In Progress",
          assignedTo: "user-1",
          assignedToUser: { name: "Asha Rao", email: "asha@example.com" },
          createdBy: "user-2",
          createdByUser: { name: "Ravi Kumar", email: "ravi@example.com" },
          board: { name: "Sprint Board" },
          project: { name: "Project Alpha" },
          tags: [{ name: "urgent" }],
          channelId: "chan-1",
          conversationId: "conv-1",
          createdAt: "2026-05-01T00:00:00.000Z",
          updatedAt: "2026-05-02T00:00:00.000Z",
        },
        {
          id: "ticket-2",
          xyneId: "XYNE-102",
          title: "Add dark mode toggle",
          statusV2: "TODO",
          priority: "LOW",
          createdAt: "2026-05-03T00:00:00.000Z",
          updatedAt: "2026-05-03T00:00:00.000Z",
        },
      ],
      formEntityValues: [],
      channel: [{ id: "chan-1", name: "general", scopeType: "DEFAULT", type: "DEFAULT" }],
    });

    const tool = await loadTool("spaces-tickets");
    const result = await tool.handler({ limit: 10 }, ctx);
    const text = result.content[0]?.text ?? "";

    expect(result.isError).toBeUndefined();
    expect(text).toMatchInlineSnapshot(`
      "2 ticket(s):

      [clf-__TOOL_CALL_ID__#1] [XYNE-101](http://localhost:3001/chat/dir/chan-1/conv-1) Login fails on SSO (id: ticket-1)
        Board Status: STARTED (workflow state, not PR verification) · Priority: HIGH · Stage: In Progress
        Assigned: Asha Rao <asha@example.com> (id: user-1)
        Created by: Ravi Kumar <ravi@example.com> (id: user-2)
        Board: Sprint Board · Project: Project Alpha
        Tags: urgent
        ChannelID: chan-1
        ConversationID: conv-1
        Created: 1/5/2026, 5:30:00 am IST · Updated: 2/5/2026, 5:30:00 am IST

      [clf-__TOOL_CALL_ID__#2] [XYNE-102] Add dark mode toggle (id: ticket-2)
        Board Status: TODO (workflow state, not PR verification) · Priority: LOW
        Created: 3/5/2026, 5:30:00 am IST · Updated: 3/5/2026, 5:30:00 am IST"
    `);
  });

  it("returns a no-results message when empty", async () => {
    mockModels({ ticket: [], formEntityValues: [] });
    const tool = await loadTool("spaces-tickets");
    const result = await tool.handler({}, ctx);
    const text = result.content[0]?.text ?? "";

    expect(result.isError).toBeUndefined();
    expect(text).toMatchInlineSnapshot(`"No tickets found."`);
  });
});

describe("spaces-activity", () => {
  it("lists activity entries", async () => {
    mockModels({
      activity: [
        {
          id: "act-1",
          actorAction: "mentioned_user",
          classification: "ACTIONABLE",
          isRead: false,
          createdAt: "2026-06-01T10:00:00.000Z",
          channelId: "chan-1",
          conversationId: "conv-1",
          messageId: "msg-1",
          actorId: "user-1",
        },
        {
          id: "act-2",
          actorAction: "replied",
          isRead: true,
          createdAt: "2026-06-02T10:00:00.000Z",
          actorId: "user-2",
        },
      ],
      channel: [{ id: "chan-1", name: "general", scopeType: "DEFAULT", type: "DEFAULT" }],
    });

    const tool = await loadTool("spaces-activity");
    const result = await tool.handler({ limit: 10 }, ctx);
    const text = result.content[0]?.text ?? "";

    expect(result.isError).toBeUndefined();
    expect(text).toMatchInlineSnapshot(`
      "2 activity entries:

      [clf-__TOOL_CALL_ID__#1] [1/6/2026, 3:30:00 pm] mentioned_user (unread) · ACTIONABLE
          actorId: user-1 · messageId: msg-1 · conversationId: conv-1 · channelId: chan-1
      [clf-__TOOL_CALL_ID__#2] [2/6/2026, 3:30:00 pm] replied
          actorId: user-2"
    `);
  });

  it("returns a no-results message when empty", async () => {
    mockModels({ activity: [] });
    const tool = await loadTool("spaces-activity");
    const result = await tool.handler({}, ctx);
    const text = result.content[0]?.text ?? "";

    expect(result.isError).toBeUndefined();
    expect(text).toMatchInlineSnapshot(`"No activity found."`);
  });
});

describe("spaces-emails", () => {
  it("lists the email thread for a conversation", async () => {
    mockModels({
      email: [
        {
          id: "email-1",
          type: "DEFAULT",
          subject: "Order delayed",
          body: "<p>My order has not arrived yet.</p>",
          to: ["support@example.com"],
          from: "customer@example.com",
          cc: [],
          bcc: [],
          conversationId: "conv-1",
          channelId: "chan-1",
          createdAt: "2026-07-01T08:00:00.000Z",
        },
        {
          id: "email-2",
          type: "OUTBOUND",
          subject: "Re: Order delayed",
          body: "<p>We are looking into it.</p>",
          to: ["customer@example.com"],
          from: "support@example.com",
          cc: [],
          bcc: [],
          conversationId: "conv-1",
          channelId: "chan-1",
          createdAt: "2026-07-01T09:00:00.000Z",
        },
      ],
      ticket: [{ conversationId: "conv-1", xyneId: "XYNE-200" }],
      channel: [{ id: "chan-1", name: "support", scopeType: "DEFAULT", type: "EMAIL" }],
    });

    const tool = await loadTool("spaces-emails");
    const result = await tool.handler({ conversationId: "conv-1", limit: 10 }, ctx);
    const text = result.content[0]?.text ?? "";

    expect(result.isError).toBeUndefined();
    expect(text).toMatchInlineSnapshot(`
      "2 email(s) in thread:

      [clf-__TOOL_CALL_ID__#1] [1] 📥 Inbound
        Subject: Order delayed
        From: customer@example.com
        To: support@example.com
        Date: 1/7/2026, 1:30:00 pm
        Body: My order has not arrived yet.

      [clf-__TOOL_CALL_ID__#2] [2] 📤 Outbound
        Subject: Re: Order delayed
        From: support@example.com
        To: customer@example.com
        Date: 1/7/2026, 2:30:00 pm
        Body: We are looking into it."
    `);
  });

  it("returns a no-results message when empty", async () => {
    mockModels({ email: [] });
    const tool = await loadTool("spaces-emails");
    const result = await tool.handler({ conversationId: "conv-none" }, ctx);
    const text = result.content[0]?.text ?? "";

    expect(result.isError).toBeUndefined();
    expect(text).toMatchInlineSnapshot(`"No emails found for conversation conv-none."`);
  });
});

describe("spaces-my-items", () => {
  it("lists scheduled messages", async () => {
    mockModels({
      scheduledMessage: [
        {
          id: "sched-1",
          title: "Weekly status reminder",
          messageContent: "<p>Reminder: submit your status update.</p>",
          channelId: "chan-1",
          daysOfWeek: ["MON"],
          scheduledTime: "09:00",
          isActive: true,
        },
        {
          id: "sched-2",
          title: "Standup nudge",
          isActive: false,
        },
      ],
      channel: [{ id: "chan-1", name: "general", scopeType: "DEFAULT", type: "DEFAULT" }],
    });

    const tool = await loadTool("spaces-my-items");
    const result = await tool.handler({ type: "scheduled" }, ctx);
    const text = result.content[0]?.text ?? "";

    expect(result.isError).toBeUndefined();
    expect(text).toMatchInlineSnapshot(`
      "2 scheduled message(s):

      [clf-__TOOL_CALL_ID__#1] Weekly status reminder
        Reminder: submit your status update.
        Schedule: at 09:00 on MON
        Channel: #general
        channelId: chan-1

      [clf-__TOOL_CALL_ID__#2] Standup nudge [inactive]"
    `);
  });

  it("returns a no-results message when empty", async () => {
    mockModels({ scheduledMessage: [] });
    const tool = await loadTool("spaces-my-items");
    const result = await tool.handler({ type: "scheduled" }, ctx);
    const text = result.content[0]?.text ?? "";

    expect(result.isError).toBeUndefined();
    expect(text).toMatchInlineSnapshot(`"No scheduled messages."`);
  });
});

// ── Automations ───────────────────────────────────────────────────────

const automationRow = {
  id: "auto-1",
  workflowName: "Escalate P1s",
  status: "ACTIVE",
  eventType: "MESSAGE_RECEIVED",
  context: JSON.stringify({
    trigger: { type: "MESSAGE_RECEIVED", config: { channelIds: ["chan-1"] } },
    steps: [{ id: "a", type: "RUN_AGENT" }, { id: "b", type: "SEND_MESSAGE" }],
  }),
  metadata: JSON.stringify({ description: "Ping oncall", createdById: "u1" }),
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-02T00:00:00.000Z",
};

const row = (patch: Record<string, unknown>) => ({ ...automationRow, ...patch });
const listText = async (args: Record<string, unknown>) =>
  (await (await loadTool("spaces-automations-list")).handler(args, ctx)).content[0]?.text ?? "";

describe("spaces-automations-list", () => {
  it("renders trigger, channels, step count and the author's name", async () => {
    mockModels({ workflow: [automationRow], user: [{ id: "u1", name: "Asha", email: "asha@x.com" }] });
    const text = await listText({});

    expect(text).toContain("Escalate P1s [auto-1]");
    expect(text).toContain("trigger: MESSAGE_RECEIVED · channels: chan-1 · steps: 2");
    expect(text).toContain("author: Asha <asha@x.com> (u1)");
  });

  it("sends the screen's default statuses and server-side filters to the gateway", async () => {
    mockModels({ workflow: [] });
    await listText({ triggerTypes: ["TICKET_CREATED"], dateField: "updatedAt", from: "2026-01-01T00:00:00.000Z" });

    const where = (mocks.interact.mock.calls[0]?.[0] as { where: Record<string, unknown> }).where;
    expect(where.workflowType).toEqual({ equals: "Automations" });
    expect(where.status).toEqual({ in: ["DRAFT", "PENDING_APPROVAL", "ACTIVE", "DISABLED"] });
    expect(where.eventType).toEqual({ in: ["TICKET_CREATED"] });
    expect(where.updatedAt).toEqual({ gte: "2026-01-01T00:00:00.000Z" });
  });

  it("filters like the Automations screen", async () => {
    mockModels({
      workflow: [
        automationRow,
        row({ id: "auto-2", workflowName: "Nightly digest", metadata: JSON.stringify({ createdById: "u1" }), context: JSON.stringify({ trigger: { type: "WEBHOOK" }, steps: [] }) }),
        row({ id: "auto-3", status: "DRAFT", metadata: JSON.stringify({ createdById: "someone-else" }) }),
      ],
    });

    // query matches the description too; another user's draft stays private.
    const byDescription = await listText({ query: "oncall" });
    expect(byDescription).toContain("[auto-1]");
    expect(byDescription).not.toContain("[auto-2]");
    expect(byDescription).not.toContain("[auto-3]");

    // channelIds matches the trigger's own channels, like the screen's channel filter.
    const byChannel = await listText({ channelIds: ["chan-1"] });
    expect(byChannel).toContain("1 automation(s) match");
    expect(byChannel).toContain("[auto-1]");
  });
});

describe("spaces-automation-runs", () => {
  it("warns that an empty result does not mean it never triggered", async () => {
    mocks.spacesFetch.mockResolvedValueOnce({ data: { runs: [], nextCursor: null } });
    const tool = await loadTool("spaces-automation-runs");
    const text = (await tool.handler({ automationId: "auto-1", statuses: ["FAILED"] }, ctx)).content[0]?.text ?? "";

    expect(text).toContain("No runs recorded");
    expect(text).toContain("do not conclude");
    expect(String(mocks.spacesFetch.mock.calls[0]?.[0])).toContain("status=FAILED");
  });

  it("merges several statuses newest first and sends from as epoch ms", async () => {
    const run = (id: string, status: string, startedAt: string, completedAt: string | null) =>
      ({ id, automationId: "auto-1", status, error: null, startedAt, completedAt });
    mocks.spacesFetch
      .mockResolvedValueOnce({ data: { runs: [run("r1", "FAILED", "2026-01-01T10:00:00.000Z", "2026-01-01T10:00:02.500Z")] } })
      .mockResolvedValueOnce({ data: { runs: [run("r2", "COMPLETED", "2026-01-02T10:00:00.000Z", "2026-01-02T10:01:05.000Z")] } });
    const tool = await loadTool("spaces-automation-runs");
    const text = (
      await tool.handler({ automationId: "auto-1", statuses: ["FAILED", "COMPLETED"], from: "2026-01-01T00:00:00.000Z" }, ctx)
    ).content[0]?.text ?? "";

    expect(text).toContain("2 run(s) — COMPLETED 1, FAILED 1");
    expect(text.indexOf("r2")).toBeLessThan(text.indexOf("r1"));
    expect(text).toContain("took 1m 5s");
    expect(text).toContain("took 2.5s");
    expect(String(mocks.spacesFetch.mock.calls[0]?.[0])).toContain(`from=${Date.parse("2026-01-01T00:00:00.000Z")}`);
  });
});

describe("spaces-automation-run", () => {
  it("surfaces a step's error unclipped even when the payload is truncated", async () => {
    const reason = `connection refused ${"x".repeat(1200)}`;
    mocks.spacesFetch.mockResolvedValueOnce({
      data: {
        run: { id: "run-2", automationId: "auto-1", status: "FAILED", error: "boom", startedAt: "t", completedAt: null },
        state: null,
        steps: [{ stepName: "webhook", status: "FAILED", data: { blob: "y".repeat(1500), error: reason } }],
      },
    });

    const tool = await loadTool("spaces-automation-run");
    const text = (await tool.handler({ runIds: ["run-2"] }, ctx)).content[0]?.text ?? "";

    expect(text).toContain("ERROR: ");
    expect(text).toContain(reason);
    expect(text).toContain("[truncated,");
  });

  it("fetches several runs and reports a missing one without failing the rest", async () => {
    mocks.spacesFetch
      .mockResolvedValueOnce({
        data: {
          run: { id: "run-1", automationId: "auto-1", status: "COMPLETED", error: null, startedAt: "2026-01-01T00:00:00.000Z", completedAt: "2026-01-01T00:00:03.000Z" },
          steps: [
            { stepName: "step_0", status: "COMPLETED", data: {}, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:01.000Z" },
            { stepName: "step_1", status: "FAILED", data: { error: "bad" }, createdAt: "2026-01-01T00:00:01.000Z", updatedAt: "2026-01-01T00:00:03.000Z" },
          ],
        },
      })
      .mockRejectedValueOnce(Object.assign(new Error("Spaces API 404"), { status: 404 }));

    const tool = await loadTool("spaces-automation-run");
    const text = (await tool.handler({ runIds: ["run-1", "run-x"], onlyFailedSteps: true }, ctx)).content[0]?.text ?? "";

    expect(text).toContain("took 3.0s");
    expect(text).toContain("Steps (1 of 2 shown — filtered)");
    expect(text).toContain("step_1 — FAILED · 2.0s");
    expect(text).toContain("# Run run-x\nNot found in this workspace.");
  });
});

describe("spaces-automation-versions", () => {
  const version = (id: string, status: string, config: Record<string, unknown>, createdAt: string) => ({
    id, name: "Escalate", description: null, status, config, createdById: "u1", createdAt, updatedAt: createdAt, automationSeriesId: "v1",
  });
  const v1 = version("v1", "ARCHIVED", {
    trigger: { type: "MESSAGE_RECEIVED", config: { channelIds: ["c1"], senderFilters: [{ userId: "u9" }] } },
    steps: [{ id: "s1", type: "SEND_MESSAGE", config: { text: "hi" } }],
  }, "2026-01-01T00:00:00.000Z");
  const v2 = version("v2", "ACTIVE", {
    trigger: { type: "MESSAGE_RECEIVED", config: { channelIds: ["c1", "c2"], senderFilters: [{ userId: "u9" }] } },
    steps: [{ id: "s1", type: "SEND_MESSAGE", config: { text: "hello" } }, { id: "s2", type: "DELAY", config: { amount: 1 } }],
    schedule: { type: "SCHEDULED", field: "ticket.closedAt" },
  }, "2026-02-01T00:00:00.000Z");
  const run = async (args: Record<string, unknown>) => {
    mocks.spacesFetch.mockResolvedValueOnce({ data: [v2, v1] });
    mockModels({ user: [{ id: "u1", name: "Asha", email: "asha@x.com" }] });
    return (await (await loadTool("spaces-automation-versions")).handler({ automationId: "v2", ...args }, ctx)).content[0]?.text ?? "";
  };

  it("lists versions with author and what changed", async () => {
    const text = await run({});
    expect(text).toContain("by Asha <asha@x.com> (u1)");
    expect(text).toContain("changes: trigger channelIds:");
    expect(text).toContain("first version");
  });

  it("compares two versions field by field", async () => {
    const text = await run({ compareFrom: "v1", compareTo: "v2" });
    expect(text).toContain('- trigger channelIds: ["c1"] → ["c1","c2"]');
    expect(text).toContain('- step s1 config.text: "hi" → "hello"');
    expect(text).toContain("- step added: s2 (DELAY)");
    expect(text).toContain('- schedule: (none) → {"type":"SCHEDULED","field":"ticket.closedAt"}');
    expect(text).not.toContain("senderFilters");
  });

  it("reports a Switch case condition change", async () => {
    const sw = (value: string) => ({
      trigger: { type: "TICKET_CREATED" },
      steps: [{ id: "sw", type: "SWITCH", config: { cases: [{ condition: { field: "priority", value }, steps: [] }], default: [] } }],
    });
    mocks.spacesFetch.mockResolvedValueOnce({
      data: [version("b", "DRAFT", sw("P2"), "2026-02-01T00:00:00.000Z"), version("a", "ACTIVE", sw("P1"), "2026-01-01T00:00:00.000Z")],
    });
    mockModels({ user: [] });
    const tool = await loadTool("spaces-automation-versions");
    const text = (await tool.handler({ automationId: "b", compareFrom: "a", compareTo: "b" }, ctx)).content[0]?.text ?? "";

    expect(text).toContain('- step sw config.cases: [{"condition":{"field":"priority","value":"P1"}}] → [{"condition":{"field":"priority","value":"P2"}}]');
  });

  it("prints an ARCHIVED version's full config", async () => {
    const text = await run({ versionId: "v1" });
    expect(text).toContain("version v1");
    expect(text).toContain("Status: ARCHIVED");
    expect(text).toContain('Trigger: MESSAGE_RECEIVED — channelIds: c1; senderFilters: [{"userId":"u9"}]');
    expect(text).toContain('"text": "hi"');
  });
});

describe("spaces-automation-variables", () => {
  it("descends into branches and prefers a step's own declared schema", async () => {
    mocks.spacesFetch
      .mockResolvedValueOnce({
        data: {
          id: "auto-1",
          name: "Branchy",
          config: {
            trigger: { type: "TICKET_CREATED" },
            steps: [
              {
                id: "cond_1",
                type: "CONDITIONAL",
                config: {
                  if_true: [{ id: "notify_1", type: "NOTIFY_USER" }],
                  if_false: [
                    {
                      id: "sw_1",
                      type: "SWITCH",
                      config: {
                        cases: [{ steps: [{ id: "agent_1", type: "RUN_AGENT", config: { outputSchema: { verdict: "string" } } }] }],
                        default: [{ id: "notify_2", type: "NOTIFY_USER" }],
                      },
                    },
                  ],
                },
              },
            ],
          },
        },
      })
      .mockResolvedValueOnce({ data: { outputSchema: { properties: { ticketId: {} } } } })
      .mockResolvedValue({ data: { outputSchema: {} } });

    const tool = await loadTool("spaces-automation-variables");
    const text = (await tool.handler({ automationId: "auto-1" }, ctx)).content[0]?.text ?? "";

    for (const id of ["cond_1", "notify_1", "sw_1", "agent_1", "notify_2"]) {
      expect(text).toContain(`id: ${id}`);
    }
    expect(text).toContain("[in if_false › case[0]]");
    expect(text).toContain("[in if_false › default]");
    expect(text).toContain("{{trigger.ticketId}}");
    expect(text).toContain("{{agent_1.output.verdict}}");
  });
});

describe("spaces-automation-create / -update", () => {
  it("creates a DRAFT and says it is not live", async () => {
    mocks.spacesFetch.mockResolvedValueOnce({ data: { automation: { id: "auto-9", name: "X", status: "DRAFT" } } });
    const tool = await loadTool("spaces-automation-create");
    const text = (await tool.handler({ name: "X", config: { trigger: {}, steps: [] } }, ctx)).content[0]?.text ?? "";

    expect(text).toContain("as DRAFT");
    expect(text).toContain("NOT running yet");
  });

  it("assigns builder-style ids to steps without one, including inside branches", async () => {
    mocks.spacesFetch.mockResolvedValueOnce({ data: { automation: { id: "auto-9", name: "X", status: "DRAFT" } } });
    const tool = await loadTool("spaces-automation-create");
    const config = {
      trigger: { type: "WEBHOOK", config: {} },
      steps: [
        { id: "keep-me", type: "DELAY", config: { amount: 1 } },
        { type: "CONDITIONAL", config: { condition: {}, if_true: [{ type: "DELAY", config: { amount: 2 } }] } },
      ],
    };
    const text = (await tool.handler({ name: "X", config }, ctx)).content[0]?.text ?? "";

    const sent = JSON.parse(String((mocks.spacesFetch.mock.calls[0]?.[1] as { body: string }).body)) as {
      config: { steps: Array<{ id: string; config: { if_true?: Array<{ id: string }> } }> };
    };
    const [kept, conditional] = sent.config.steps;
    expect(kept?.id).toBe("keep-me");
    expect(conditional?.id).toMatch(/^stp_[0-9a-f]{32}$/);
    expect(conditional?.config.if_true?.[0]?.id).toMatch(/^stp_[0-9a-f]{32}$/);
    expect(text).toContain("Assigned ids to 2 step(s) that had none:");
    expect(text).toContain(`(DELAY, in if_true) → ${conditional?.config.if_true?.[0]?.id}`);
  });

  it("refuses duplicate and reserved step ids without calling the backend", async () => {
    const config = {
      trigger: { type: "WEBHOOK", config: {} },
      steps: [
        { id: "wait", type: "DELAY", config: {} },
        { id: "trigger", type: "DELAY", config: {} },
        { id: "c1", type: "CONDITIONAL", config: { if_true: [{ id: "wait", type: "DELAY", config: {} }] } },
      ],
    };
    const create = await (await loadTool("spaces-automation-create")).handler({ name: "X", config }, ctx);
    const update = await (await loadTool("spaces-automation-update")).handler({ automationId: "auto-1", config }, ctx);

    for (const result of [create, update]) {
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('"trigger" is reserved');
      expect(result.content[0]?.text).toContain('"wait" is used by more than one step');
    }
    expect(mocks.spacesFetch).not.toHaveBeenCalled();
  });

  it("refuses a create with no config, without calling the backend", async () => {
    const tool = await loadTool("spaces-automation-create");
    expect((await tool.handler({ name: "x" }, ctx)).isError).toBe(true);
    expect(mocks.spacesFetch).not.toHaveBeenCalled();
  });

  it("distinguishes an in-place draft edit from a new version", async () => {
    mocks.spacesFetch.mockResolvedValueOnce({ data: { automation: { id: "auto-1", name: "R", status: "DRAFT" } } });
    const tool = await loadTool("spaces-automation-update");
    expect((await tool.handler({ automationId: "auto-1", name: "R" }, ctx)).content[0]?.text).toContain("in place");

    mocks.spacesFetch.mockResolvedValueOnce({ data: { automation: { id: "auto-2", name: "R", status: "DRAFT" } } });
    const text = (await tool.handler({ automationId: "auto-1", name: "R" }, ctx)).content[0]?.text ?? "";
    expect(text).toContain("NEW DRAFT VERSION (auto-2)");
  });
});

describe("spaces-automation-validate", () => {
  it("reads the endpoint's `issues` field, not `errors`", async () => {
    mocks.spacesFetch.mockResolvedValueOnce({
      data: { valid: false, issues: [{ path: "steps.0.type", message: "unknown step" }] },
    });

    const tool = await loadTool("spaces-automation-validate");
    const text = (await tool.handler({ config: { trigger: {}, steps: [] } }, ctx)).content[0]?.text ?? "";

    expect(text).toContain("Config is INVALID.");
    expect(text).toContain("unknown step");
  });

  it("marks a backend-valid config with a duplicate step id INVALID", async () => {
    mocks.spacesFetch.mockResolvedValueOnce({ data: { valid: true, issues: [] } });
    const tool = await loadTool("spaces-automation-validate");
    const config = { trigger: {}, steps: [{ id: "a", type: "DELAY" }, { id: "a", type: "DELAY" }] };
    const text = (await tool.handler({ config }, ctx)).content[0]?.text ?? "";

    expect(text).toContain("Config is INVALID.");
    expect(text).toContain('"a" is used by more than one step');
  });
});

describe("spaces-automation-webhook-issue", () => {
  it("returns the once-only URL", async () => {
    mocks.spacesFetch.mockResolvedValueOnce({ data: { url: "https://x/series-1/s3cr3t", alreadyIssued: false } });
    const tool = await loadTool("spaces-automation-webhook-issue");
    const text = (await tool.handler({ automationId: "auto-1" }, ctx)).content[0]?.text ?? "";

    expect(text).toContain("s3cr3t");
    expect(text).toContain("shown ONCE");
  });
});

