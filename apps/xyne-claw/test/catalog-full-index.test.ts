import { afterEach, describe, expect, it } from "vitest";
import { renderToolCatalogForPrompt, type ToolCatalogEntry } from "../src/tool-catalog.js";
import { OPTIMIZATIONS } from "../src/optimizations.js";

function entry(catalog: string, name: string, description = `${name} does a specific thing for the user`): ToolCatalogEntry {
  return { name, oneLineDescription: description, source: `subagent:${catalog}`, catalog } as ToolCatalogEntry;
}

function catalogOf(name: string, count: number, description?: string): ToolCatalogEntry[] {
  return Array.from({ length: count }, (_, i) => entry(name, `${name}-tool-${String(i).padStart(3, "0")}`, description));
}

const smallCatalog = catalogOf("github", 4);
const spacesCatalog = catalogOf("spaces", 54);

afterEach(() => {
  delete process.env["XYNE_CATALOG_INDEX_BUDGET"];
});

describe("catalog index, flag off", () => {
  it("collapses a catalog over 15 tools to its header, as before", () => {
    const out = renderToolCatalogForPrompt([...smallCatalog, ...spacesCatalog]);
    expect(out).toContain("- **spaces** (54 tools) — call search-tools with this catalog to see its tools.");
    expect(out).not.toContain("spaces-tool-000");
    expect(out).toContain("github-tool-000: github-tool-000 does a specific thing for the user");
  });

  it("is unchanged when fullIndex is passed as false", () => {
    const all = [...smallCatalog, ...spacesCatalog];
    expect(renderToolCatalogForPrompt(all, { fullIndex: false })).toBe(renderToolCatalogForPrompt(all));
  });

  it("does not carry the load-by-name instruction", () => {
    expect(renderToolCatalogForPrompt(spacesCatalog)).not.toContain("no search needed");
  });
});

describe("catalog index, flag on", () => {
  it("names every tool of a large catalog with its one-liner when it fits", () => {
    const out = renderToolCatalogForPrompt(spacesCatalog, { fullIndex: true });
    for (const tool of spacesCatalog) expect(out).toContain(`- ${tool.name}: `);
    expect(out).not.toContain("call search-tools with this catalog");
  });

  it("tells the model to load specific tools by exact name, not whole catalogs", () => {
    const out = renderToolCatalogForPrompt(spacesCatalog, { fullIndex: true });
    expect(out).toContain("pass their exact names to `load-tools`");
    expect(out).toContain("Do not load a whole catalog");
  });

  it("clips long one-liners instead of dropping tools", () => {
    const long = catalogOf("wide", 3, "x".repeat(600));
    const out = renderToolCatalogForPrompt(long, { fullIndex: true });
    expect(out).toContain("…");
    expect(out).not.toContain("x".repeat(320));
  });

  it("stays within the budget and keeps every name when descriptions cannot fit", () => {
    process.env["XYNE_CATALOG_INDEX_BUDGET"] = "6000";
    const huge = [...catalogOf("spaces", 120), ...catalogOf("github", 90), ...smallCatalog];
    const out = renderToolCatalogForPrompt(huge, { fullIndex: true });
    const sections = out.split("\n").filter((line) => line.startsWith("- **") || line.startsWith("    - ")).join("\n");
    expect(sections.length).toBeLessThanOrEqual(6000);
    for (const tool of huge) expect(out).toContain(tool.name);
  });

  it("demotes the largest catalog first and leaves small ones fully described", () => {
    process.env["XYNE_CATALOG_INDEX_BUDGET"] = "6000";
    const out = renderToolCatalogForPrompt([...catalogOf("spaces", 120), ...smallCatalog], { fullIndex: true });
    expect(out).toContain("- **spaces** (120 tools): spaces-tool-000, spaces-tool-001");
    expect(out).toContain("    - github-tool-000: github-tool-000 does a specific thing for the user");
  });

  it("falls back to headers only when even names exceed the budget", () => {
    process.env["XYNE_CATALOG_INDEX_BUDGET"] = "2000";
    const out = renderToolCatalogForPrompt(catalogOf("spaces", 400), { fullIndex: true });
    expect(out).toContain("- **spaces** (400 tools) — call search-tools with this catalog to see its tools.");
  });

  it("ignores a budget below the floor", () => {
    process.env["XYNE_CATALOG_INDEX_BUDGET"] = "10";
    const out = renderToolCatalogForPrompt(spacesCatalog, { fullIndex: true });
    for (const tool of spacesCatalog) expect(out).toContain(tool.name);
  });

  it("returns nothing for an empty catalog", () => {
    expect(renderToolCatalogForPrompt([], { fullIndex: true })).toBe("");
  });
});

describe("catalog_full_index switch", () => {
  it("is registered and off by default", () => {
    expect(OPTIMIZATIONS.catalog_full_index.defaultOn).toBe(false);
  });
});
