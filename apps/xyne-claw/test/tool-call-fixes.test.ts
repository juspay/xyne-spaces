import { afterEach, describe, expect, it, vi } from "vitest";

// The raw-result copy is uploaded to GCS; keep tests off the network.
vi.mock("../src/storage.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/storage.js")>()),
  gcsUploadSessionFile: async () => false,
}));
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createScopedToolMap } from "../src/scoped-tools.js";
import { promoteIfOversized } from "../src/tool-output.js";

let base = "";
afterEach(() => {
  if (base) rmSync(base, { recursive: true, force: true });
  base = "";
});

describe("wrong-path errors (XYNE-66597)", () => {
  function setup() {
    base = mkdtempSync(join(tmpdir(), "paths-"));
    const workspace = join(base, "workspaces", "conv_agent");
    const context = join(base, "sessions", "conv_agent", ".context");
    mkdirSync(workspace, { recursive: true });
    mkdirSync(join(context, "tool-results"), { recursive: true });
    return { workspace, context };
  }

  it("a missing path says where the working directory and saved tool results are", async () => {
    const { workspace, context } = setup();
    const tools = createScopedToolMap(workspace, [context]);
    await expect(tools.ls!.execute("1", { path: "tool-results" })).rejects.toThrow(
      new RegExp(`Path not found[\\s\\S]*working directory ${workspace}\\.[\\s\\S]*Saved tool results are under ${join(context, "tool-results")}`),
    );
  });

  it("leaves other errors unchanged", async () => {
    const { workspace, context } = setup();
    const tools = createScopedToolMap(workspace, [context]);
    const outside = await tools.read!.execute("2", { path: "/etc/passwd" });
    expect(JSON.stringify(outside.content)).toContain("outside the session working directory");
  });

  it("the raw-result note gives the absolute path, not only the sandbox-copy-in path", async () => {
    base = mkdtempSync(join(tmpdir(), "spill-"));
    const text = await promoteIfOversized(base, "grafana", "query", '{"rows":1}', undefined, true);
    const abs = text.match(/Full raw result also saved at (\S+) —/)?.[1];
    expect(abs).toBeDefined();
    expect(abs!.startsWith(join(base, ".context", "tool-results"))).toBe(true);
    expect(text).toContain('sandbox-copy-in contextPath: "tool-results/');
  });
});
