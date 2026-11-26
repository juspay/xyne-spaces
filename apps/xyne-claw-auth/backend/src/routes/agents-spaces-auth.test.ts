/**
 * Spaces' `authenticate` reads the user JWT only from `xyne_ws_<workspaceId>_token`,
 * so the Spaces App setup calls (create / install / webhook / permissions) 401
 * TOKEN_MISSING unless that cookie is sent.
 */

import { describe, expect, it } from "vitest";

const { spacesUserAuthHeaders } = await import("./agents.js");

describe("spacesUserAuthHeaders", () => {
  it("sends the user token in the workspace cookie Spaces authenticates with", () => {
    const headers = spacesUserAuthHeaders("jwt.a.b", "sess-1", "ws-1");
    expect(headers["x-workspace-id"]).toBe("ws-1");
    expect(headers["Cookie"]!.split("; ")).toEqual([
      "xyne_session=sess-1",
      "xyne_last_workspace=ws-1",
      "xyne_ws_ws-1_token=jwt.a.b",
    ]);
    expect(headers["Authorization"]).toBe("Bearer jwt.a.b");
  });

  it("sends no workspace cookie when the workspace is unknown", () => {
    const headers = spacesUserAuthHeaders("jwt.a.b", "sess-1", undefined);
    expect(headers["Cookie"]).toBe("xyne_session=sess-1");
    expect(headers["x-workspace-id"]).toBeUndefined();
  });
});
