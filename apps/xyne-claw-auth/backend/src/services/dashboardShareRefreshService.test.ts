import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  persist: vi.fn(),
  upsert: vi.fn(),
}));

vi.mock("./chatAttachmentService.js", () => ({
  persistBase64ChatAttachments: mocks.persist,
}));
vi.mock("../routes/design-shares.js", () => ({
  upsertDesignShare: mocks.upsert,
}));

import { isDashboardTask, refreshScheduledDashboardShare } from "./dashboardShareRefreshService.js";

describe("scheduled dashboard share refresh", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.persist.mockResolvedValue([
      { id: "notes", originalFilename: "notes.txt", mimeType: "text/plain" },
      { id: "dashboard-v2", originalFilename: "reliability.html", mimeType: "text/html" },
    ]);
    mocks.upsert.mockResolvedValue({ id: "share-1", sharePath: "/claw/v3/design/shared#token", linkChanged: false });
  });

  it("recognizes only the leading dashboard command", () => {
    expect(isDashboardTask(" /DASHBOARD\nerrors")).toBe(true);
    expect(isDashboardTask("please /dashboard errors")).toBe(false);
    expect(isDashboardTask("/dashboards errors")).toBe(false);
  });

  it("persists the HTML and refreshes the original human owner's conversation share", async () => {
    const attachments = [{ fileName: "reliability.html", mimeType: "text/html", data: "PGh0bWw+" }];
    const result = await refreshScheduledDashboardShare({
      task: "/dashboard reliability",
      chatMessageId: "message-2",
      ownerUserId: "human-owner",
      orgId: "org-1",
      conversationId: "original-thread",
      attachments,
    });

    expect(mocks.persist).toHaveBeenCalledWith("message-2", "human-owner", attachments);
    expect(mocks.upsert).toHaveBeenCalledWith({
      ownerUserId: "human-owner",
      orgId: "org-1",
      conversationId: "original-thread",
      attachmentId: "dashboard-v2",
      title: "reliability",
      expiresAt: null,
    });
    expect(result).toMatchObject({ reason: "refreshed", share: { id: "share-1", linkChanged: false } });
  });

  it("does not create or update a share when no HTML was delivered", async () => {
    mocks.persist.mockResolvedValue([{ id: "csv", originalFilename: "data.csv", mimeType: "text/csv" }]);
    const result = await refreshScheduledDashboardShare({
      task: "/dashboard reliability",
      chatMessageId: "message-2",
      ownerUserId: "human-owner",
      orgId: "org-1",
      conversationId: "original-thread",
      attachments: [],
    });

    expect(result.reason).toBe("missing_html");
    expect(mocks.upsert).not.toHaveBeenCalled();
  });

  it("does nothing for ordinary scheduled tasks", async () => {
    const result = await refreshScheduledDashboardShare({
      task: "Send the daily summary",
      chatMessageId: "message-2",
      ownerUserId: "human-owner",
      orgId: "org-1",
      conversationId: "original-thread",
      attachments: [],
    });
    expect(result.reason).toBe("not_dashboard");
    expect(mocks.persist).not.toHaveBeenCalled();
    expect(mocks.upsert).not.toHaveBeenCalled();
  });
});
