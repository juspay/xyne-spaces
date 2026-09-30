import { afterEach, describe, expect, it } from "vitest";
import { SDLC_DIRECT_TOOL_NAMES, SDLC_MCP_SERVER_TYPE } from "xyne-claw-shared";

process.env["ENCRYPTION_KEY"] ||= "00".repeat(32);
process.env["XYNE_CLAW_URL"] = "http://claw.local";
process.env["XYNE_CLAW_S2S_KEY"] = "s2s-secret";

const { sdlcSpacesUrl, xyneSpacesSdlcAdapter } = await import("./xyne-spaces-sdlc.js");
const { STATIC_ADAPTERS } = await import("../static-adapters.js");
const { sdlcTools, tools } = await import("../servers/xyne-spaces-tools.js");

describe("xyne-spaces-sdlc adapter", () => {
  afterEach(() => {
    delete process.env["SPACES_SDLC_URL"];
  });

  it("is registered under the SDLC server type", () => {
    expect(STATIC_ADAPTERS[SDLC_MCP_SERVER_TYPE]).toBe(xyneSpacesSdlcAdapter);
  });

  it("uses SPACES_SDLC_URL and falls back to the Spaces URL", () => {
    expect(sdlcSpacesUrl("http://spaces.local/")).toBe("http://spaces.local");
    process.env["SPACES_SDLC_URL"] = " http://sdlc.local// ";
    expect(sdlcSpacesUrl("http://spaces.local")).toBe("http://sdlc.local");
  });

  it("passes the SDLC URL and the run's Spaces credentials to the server", () => {
    process.env["SPACES_SDLC_URL"] = "http://sdlc.local";
    const { env } = xyneSpacesSdlcAdapter.buildCommand({
      url: "http://spaces.local",
      token: "tok",
      sessionId: "sess",
      workspaceId: "ws",
      userId: "u1",
      authMode: "app",
    });
    expect(env).toMatchObject({
      XYNE_SPACES_URL: "http://sdlc.local",
      XYNE_SPACES_TOKEN: "tok",
      XYNE_SPACES_SESSION_ID: "sess",
      XYNE_SPACES_WORKSPACE_ID: "ws",
      XYNE_SPACES_AUTH_MODE: "app",
      XYNE_USER_ID: "u1",
    });
  });
});

describe("tool split", () => {
  it("serves every SDLC tool from the SDLC server and none from xyne-spaces", () => {
    expect(sdlcTools.map((t) => t.name).sort()).toEqual([...SDLC_DIRECT_TOOL_NAMES].sort());
    const spacesNames = new Set(tools.map((t) => t.name));
    expect(SDLC_DIRECT_TOOL_NAMES.filter((name) => spacesNames.has(name))).toEqual([]);
  });
});
