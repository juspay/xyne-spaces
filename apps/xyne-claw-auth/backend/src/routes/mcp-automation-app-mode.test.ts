import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tools as spacesTools } from "../mcp/servers/xyne-spaces-tools.js";

const here = dirname(fileURLToPath(import.meta.url));
const mcpSrc = readFileSync(resolve(here, "./mcp.ts"), "utf8");
const webhookSrc = readFileSync(resolve(here, "./webhook.ts"), "utf8");
const serverSrc = readFileSync(
  resolve(here, "../mcp/servers/xyne-spaces-app-tools-server.ts"),
  "utf8",
);

// The automation app-mode swap is decided at ENTRY BUILD (which servers get
// listed), not by splicing the finished listing. These tests pin the load-
// bearing pieces of that design so a refactor can't silently revert to the
// old post-hoc swap/de-dup or lose the explicit dispatch flag.

describe("automation detection", () => {
  it("gates on the explicit isAutomation flag with the legacy proxy as fallback", () => {
    const gate = mcpSrc.slice(
      mcpSrc.indexOf("const isAutomationRun ="),
      mcpSrc.indexOf("let automationAppSwap"),
    );
    expect(gate).toContain("runCtx?.isAutomation === true");
    // Sessions dispatched before the flag existed carry only the proxy pair.
    expect(gate).toContain("runCtx?.resolveMentions === true");
    expect(gate).toContain("runCtx?.externalResultCallback");
  });

  it("sets isAutomation on both automation dispatch contexts in webhook.ts", () => {
    // Site 1: the interpose SessionContext. Site 2: the recovery context —
    // which is the one the proxy MISSES for plain-callback automations
    // (no externalResultCallback, no interpose → neither proxy flag is set).
    const matches = webhookSrc.match(/isAutomation: true,/g) ?? [];
    expect(matches.length).toBeGreaterThanOrEqual(2);
  });
});

describe("entry-stage swap", () => {
  it("removes xyne-spaces entries before any listing is built", () => {
    // The splice targets `entries` (pre-listing), not `data` (post-listing).
    const swap = mcpSrc.slice(
      mcpSrc.indexOf("let automationAppSwap"),
      mcpSrc.indexOf("Virtual xyne-spaces entry"),
    );
    expect(swap).toContain("entries.splice(i, 1)");
    expect(swap).not.toContain("data.splice");
  });

  it("keeps the user server when the app token cannot resolve", () => {
    // Swapping without app creds would strip Spaces access entirely and
    // silently break the run — the gate must require both preconditions.
    const swap = mcpSrc.slice(
      mcpSrc.indexOf("let automationAppSwap"),
      mcpSrc.indexOf("Virtual xyne-spaces entry"),
    );
    expect(swap).toContain("if (appCreds && appToolsRow)");
    expect(swap).toContain("automation app-mode SKIPPED");
  });

  it("suppresses the app-token xyne-spaces fallback listing under the swap", () => {
    // Without this gate the fallback re-lists the user server (with app
    // creds) right after the swap removed it, resurrecting the duplicate.
    expect(mcpSrc).toContain("if (!hasSpacesConnection && !automationAppSwap)");
  });
});

describe("non-automation runs", () => {
  it("reduces app-tools to its app-native tools unconditionally", () => {
    // The old de-dup only removed name collisions with the user server, so
    // whenever xyne-spaces happened to be missing, a HUMAN's run saw the full
    // registry through the bot identity (app creds, no user ACLs). The filter
    // must not depend on the user server being present.
    const filter = mcpSrc.slice(
      mcpSrc.indexOf("if (!automationAppSwap) {"),
      mcpSrc.indexOf("if (strictAgentToolsConfig && sessionAgentTools)"),
    );
    expect(filter).toContain("APP_ONLY_TOOL_NAMES.has(t.name)");
    expect(filter).not.toContain("userToolNames");
  });
});

describe("userOnly tools in app mode", () => {
  it("marks the tools whose handlers require a human session", () => {
    const userOnly = spacesTools.filter((t) => t.userOnly).map((t) => t.name).sort();
    expect(userOnly).toEqual(["spaces-update-ticket", "spaces-upload-to-kb", "user-send-message"]);
  });

  it("hides them from the app-tools listing and rejects calls", () => {
    // The server always runs in app mode; a listed userOnly tool could only
    // 401. Both the listing filter and the dispatch guard must exist.
    expect(serverSrc).toContain(".filter((t) => !t.userOnly)");
    expect(serverSrc).toContain("if (registryTool.userOnly)");
  });

  it("keeps every appHandler-bearing tool available in app mode", () => {
    for (const t of spacesTools.filter((t) => t.appHandler)) {
      expect(t.userOnly).toBeUndefined();
    }
  });
});
