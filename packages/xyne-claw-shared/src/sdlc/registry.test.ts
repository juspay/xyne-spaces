import { describe, expect, it } from "vitest";
import {
  buildSdlcAgentToolProfile,
  mergeSdlcToolProfile,
  SDLC_DIRECT_TOOL_NAMES,
  SDLC_TOOL_NAMES,
  withSdlcToolsConfig,
} from "./registry.js";

const profile = buildSdlcAgentToolProfile([...SDLC_DIRECT_TOOL_NAMES, "spaces-search", "spaces-create-ticket"]);
const write = `xyne-spaces__${SDLC_TOOL_NAMES.writeArtifact}`;
const read = `xyne-spaces__${SDLC_TOOL_NAMES.readArtifact}`;

describe("mergeSdlcToolProfile", () => {
  const agent = {
    tools: { direct: ["jira-search"], custom: ["genius-analytics"], subagents: ["spaces"] },
    toolPermissions: { "jira__create": "ask", [write]: "allow" },
  };

  it("adds the SDLC tools and keeps the agent's own", () => {
    const merged = mergeSdlcToolProfile(agent, profile, { interactive: true });
    const tools = merged["tools"] as Record<string, string[]>;
    expect(tools["direct"]).toEqual(expect.arrayContaining(["jira-search", SDLC_TOOL_NAMES.writeArtifact]));
    expect(tools["custom"]).toEqual(expect.arrayContaining(["genius-analytics", "sdlc-repository-access"]));
    expect(tools["subagents"]).toEqual(expect.arrayContaining(["spaces", "github"]));
    expect(new Set(tools["direct"]).size).toBe(tools["direct"]!.length);
  });

  it("asks before writes on a watched run and allows them on automation", () => {
    const watched = mergeSdlcToolProfile(agent, profile, { interactive: true })["toolPermissions"] as Record<string, string>;
    const headless = mergeSdlcToolProfile(agent, profile, { interactive: false })["toolPermissions"] as Record<string, string>;
    expect(watched[write]).toBe("ask");
    expect(watched["xyne-spaces__spaces-create-ticket"]).toBe("ask");
    expect(headless[write]).toBe("allow");
    expect(watched[read]).toBe("allow");
    expect(watched["jira__create"]).toBe("ask");
  });

  it("keeps an unrestricted agent unrestricted but still asks before its writes", () => {
    const merged = mergeSdlcToolProfile({ modelSettings: { speed: "fast" } }, profile, { interactive: true });
    expect(merged).not.toHaveProperty("tools");
    expect((merged["toolPermissions"] as Record<string, string>)[write]).toBe("ask");
  });
});

describe("withSdlcToolsConfig", () => {
  it("unions the SDLC tools into a selection and leaves no selection as none", () => {
    expect(withSdlcToolsConfig(undefined, profile)).toBeUndefined();
    const tools = withSdlcToolsConfig({ subagents: ["jira"] }, profile)!;
    expect(tools["subagents"]).toEqual(expect.arrayContaining(["jira", "github"]));
    expect(tools["direct"]).toEqual(expect.arrayContaining([SDLC_TOOL_NAMES.createTrackFolder]));
  });
});
