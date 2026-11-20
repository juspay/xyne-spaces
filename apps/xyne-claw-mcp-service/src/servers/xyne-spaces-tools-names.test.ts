/** Compares xyne-claw-mcp-common/spaces-tool-names with the tools of xyne-spaces-tools.ts. */
import { afterEach, describe, expect, it, vi } from "vitest";
import { spacesMcpToolNames } from "xyne-claw-mcp-common/spaces-tool-names";

async function realToolNames(directVespa: boolean): Promise<string[]> {
  vi.resetModules();
  process.env["DIRECT_VESPA_SEARCH"] = directVespa ? "true" : "";
  const { tools } = await import("./xyne-spaces-tools.js");
  return tools.map((t) => t.name);
}

describe("spaces tool name list", () => {
  afterEach(() => {
    delete process.env["DIRECT_VESPA_SEARCH"];
  });

  it("matches the tools with direct Vespa search off", async () => {
    expect(spacesMcpToolNames(false)).toEqual(await realToolNames(false));
  });

  it("matches the tools with direct Vespa search on", async () => {
    expect(spacesMcpToolNames(true)).toEqual(await realToolNames(true));
  });
});
