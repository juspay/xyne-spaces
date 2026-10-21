import { describe, expect, it } from "vitest";
import { buildFastModeMetaTools, renderToolCatalogForPrompt, type ToolCatalogEntry } from "../src/tool-catalog.js";

const entry = (name: string, oneLineDescription: string, catalog: string, source = `subagent:${catalog}`): ToolCatalogEntry =>
  ({ name, oneLineDescription, catalog, source }) as ToolCatalogEntry;

const catalog = [
  entry("Xyne_Spaces__spaces-sdlc-create-pull-request", "Create an SDLC pull request in Spaces", "spaces"),
  entry("Bitbucket__list-pull-requests", "List pull requests for a Bitbucket repository", "bitbucket"),
  entry("Xyne_Spaces__spaces-messages", "Read channel messages", "spaces"),
];
const active = [
  entry("Bitbucket__create_pull_request", "Create a pull request in a Bitbucket repository", "active", "active"),
  entry("Bitbucket__list_repositories", "List repositories in a Bitbucket project", "active", "active"),
  entry("bitbucket", "[Subagent] Bitbucket: read and write repositories, pull requests and branches", "active", "active"),
];

function search(opts: { activeTools?: ToolCatalogEntry[] }, params: Record<string, unknown>) {
  const tools = buildFastModeMetaTools({
    catalog,
    controller: { getActiveToolSet: () => [], loadTools: async () => ({ loaded: [], alreadyLoaded: [], unknown: [], activeToolSet: [], maxActiveTools: 128 }) },
    ...opts,
  });
  const def = tools.find((t) => t.name === "search-tools")! as unknown as { description: string; execute: (id: string, p: unknown) => Promise<{ content: Array<{ text: string }> }> };
  return { def, run: () => def.execute("t", params).then((r) => r.content.map((c) => c.text).join("\n")) };
}

describe("search-tools and tools the run already has", () => {
  it("lists a matching active tool first, marked callable, in the exact case that failed in prod", async () => {
    const out = await search({ activeTools: active }, { query: "create pull request bitbucket" }).run();
    expect(out.startsWith("## already active — call directly, no search or load needed")).toBe(true);
    expect(out.indexOf("Bitbucket__create_pull_request")).toBeLessThan(out.indexOf("Xyne_Spaces__spaces-sdlc-create-pull-request"));
  });

  it("answers from active tools when nothing loadable matches, instead of saying nothing exists", async () => {
    const out = await search({ activeTools: active }, { query: "repositories project" }).run();
    expect(out).toContain("tool(s) you already have do — call them directly");
    expect(out).toContain("Bitbucket__list_repositories");
  });

  it("changes nothing when active tools are not supplied", async () => {
    const out = await search({}, { query: "create pull request bitbucket" }).run();
    expect(out).not.toContain("already active");
  });

  it("keeps a catalog-scoped search to that catalog", async () => {
    const out = await search({ activeTools: active }, { query: "create pull request", catalog: "spaces" }).run();
    expect(out).not.toContain("already active");
  });

  it("tells the model to call a tool it already has instead of searching", () => {
    const on = search({ activeTools: active }, {}).def.description;
    const off = search({}, {}).def.description;
    expect(on).toContain("if a tool already in your tool list fits, call it directly");
    expect(off).toContain("Call it before guessing a tool name.");
    expect(on).not.toContain("Call it before guessing a tool name.");
  });

  it("says in the full index that active tools never need searching", () => {
    expect(renderToolCatalogForPrompt(catalog, { fullIndex: true })).toContain("Tools already in your tool list are ready to call");
    expect(renderToolCatalogForPrompt(catalog)).not.toContain("Tools already in your tool list are ready to call");
  });

  it("load-tools says a tool the run already has is active, never Unknown", async () => {
    const tools = buildFastModeMetaTools({
      catalog,
      activeTools: active,
      controller: { getActiveToolSet: () => [], loadTools: async (n: string[]) => ({ loaded: n, alreadyLoaded: [], unknown: [], activeToolSet: n, maxActiveTools: 26 }) },
    });
    const load = tools.find((t) => t.name === "load-tools")! as unknown as { execute: (id: string, p: unknown) => Promise<{ content: Array<{ text: string }> }> };
    const out = (await load.execute("t", { names: ["Bitbucket__create_pull_request", "create_pull_request", "Xyne_Spaces__spaces-messages"] })).content[0]!.text;
    expect(out).toContain("Already active — nothing to load, call directly: Bitbucket__create_pull_request");
    expect(out).not.toMatch(/Unknown[^\n]*create_pull_request/);
    expect(out).toContain("Loaded: Xyne_Spaces__spaces-messages");
    expect(out).toContain("the 3 tools you started with are separate and always callable");
  });

  it("load-tools still reports a genuinely unknown name", async () => {
    const tools = buildFastModeMetaTools({ catalog, activeTools: active, controller: { getActiveToolSet: () => [], loadTools: async (n: string[]) => ({ loaded: n, alreadyLoaded: [], unknown: [], activeToolSet: n, maxActiveTools: 26 }) } });
    const load = tools.find((t) => t.name === "load-tools")! as unknown as { execute: (id: string, p: unknown) => Promise<{ content: Array<{ text: string }> }> };
    const out = (await load.execute("t", { names: ["Nope__no-such-tool"] })).content[0]!.text;
    expect(out).toMatch(/Nope__no-such-tool/);
    expect(out).not.toContain("Already active");
  });
});

describe("load-tools resolves the names models actually send", () => {
  const load = (activeTools: ToolCatalogEntry[], names: string[]) => {
    const tools = buildFastModeMetaTools({
      catalog: [...catalog, entry("create-video-explainer", "Make a video explainer", "agent-tools", "agent:agent-tools")],
      activeTools,
      controller: { getActiveToolSet: () => [], loadTools: async (n: string[]) => ({ loaded: n, alreadyLoaded: [], unknown: [], activeToolSet: n, maxActiveTools: 26 }) },
    });
    const def = tools.find((t) => t.name === "load-tools")! as unknown as { execute: (id: string, p: unknown) => Promise<{ content: Array<{ text: string }> }> };
    return def.execute("t", { names }).then((r) => r.content[0]!.text);
  };
  const scheduleTask = entry("schedule-task", "Schedule a task", "active", "active");

  it("maps a display label to the active tool it names", async () => {
    const out = await load([...active, scheduleTask], ["Schedule Task"]);
    expect(out).toContain("Already active — nothing to load, call directly: schedule-task");
    expect(out).not.toMatch(/Unknown[^\n]*Schedule Task/);
  });

  it("maps a display label to a loadable catalog tool", async () => {
    const out = await load(active, ["Create Video Explainer"]);
    expect(out).toContain("Loaded: create-video-explainer");
  });

  it("maps underscores and case to the catalog name", async () => {
    const out = await load(active, ["XYNE_SPACES__SPACES_MESSAGES"]);
    expect(out).toContain("Loaded: Xyne_Spaces__spaces-messages");
  });

  it("still reports a name that matches nothing", async () => {
    const out = await load(active, ["Totally Made Up"]);
    expect(out).toMatch(/Totally Made Up/);
    expect(out).not.toContain("Loaded: ");
  });
});
