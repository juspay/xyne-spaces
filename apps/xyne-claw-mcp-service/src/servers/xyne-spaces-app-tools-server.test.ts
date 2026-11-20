import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { builtinServerPath } from "./index.js";
import { tools as spacesTools } from "./xyne-spaces-tools.js";

describe("xyne-spaces-app-tools-server", () => {
  it("hides userOnly tools from the listing and rejects calls to them", () => {
    // The server always runs in app mode; a listed userOnly tool could only
    // 401. Both the listing filter and the dispatch guard must exist.
    const src = readFileSync(builtinServerPath("xyne-spaces-app-tools-server"), "utf8");
    expect(src).toContain(".filter((t) => !t.userOnly)");
    expect(src).toContain("if (registryTool.userOnly)");
  });

  it("marks the tools whose handlers require a human session as userOnly", () => {
    const userOnly = spacesTools.filter((t) => t.userOnly).map((t) => t.name).sort();
    expect(userOnly).toEqual([
      ...["agents", "create", "get", "run", "runs", "schema", "submit", "update", "validate", "variables", "versions", "webhook", "webhook-issue"].map(
        (t) => `spaces-automation-${t}`,
      ),
      // Sends as the desk on a human's behalf through a user-session-only
      // Spaces route, so an automation run cannot reach it.
      "spaces-send-ticket-email",
      "spaces-update-bulk-tickets",
      "spaces-update-ticket",
      "spaces-upload-to-kb",
      "user-send-message",
    ]);
  });

  it("keeps every appHandler-bearing tool available in app mode", () => {
    for (const t of spacesTools.filter((t) => t.appHandler)) {
      expect(t.userOnly).toBeUndefined();
    }
  });
});
