import { afterAll, beforeAll, expect, test } from "vitest";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createScopedToolMap } from "../src/scoped-tools.js";
import { promoteIfOversized, TOOL_RESULT_INLINE_CAP_BYTES } from "../src/tool-output.js";

let root: string;
let workspace: string;
let sessionDir: string;

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "scoped-tools-"));
  workspace = join(root, "workspace");
  sessionDir = join(root, "session");
  await mkdir(workspace, { recursive: true });
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

async function executeText(
  tool: ReturnType<typeof createScopedToolMap>[string],
  params: Record<string, unknown>,
): Promise<string> {
  const result = await tool.execute("test-call", params as never, undefined, undefined);
  return result.content
    .filter((block): block is { type: "text"; text: string } => block.type === "text")
    .map((block) => block.text)
    .join("\n");
}

test("scoped read can recover an oversized result from the session context", async () => {
  const payload = "spill-content\n".repeat(TOOL_RESULT_INLINE_CAP_BYTES);
  const promoted = await promoteIfOversized(sessionDir, "custom", "sandbox-sdlc-git-context", payload);
  const spillPath = /full result saved to ([^\n]+)\./.exec(promoted)?.[1];
  expect(spillPath).toBeTruthy();

  const tools = createScopedToolMap(workspace, [join(sessionDir, ".context")]);
  const recovered = await executeText(tools.read!, { path: spillPath });
  expect(recovered).toContain("spill-content");
});

test("scoped tools write only inside the workspace and reject unrelated paths", async () => {
  const tools = createScopedToolMap(workspace, [join(sessionDir, ".context")]);
  const workspaceFile = join(workspace, "generated.txt");
  const spillFile = join(sessionDir, ".context", "tool-results", "protected.txt");
  const unrelatedFile = join(root, "other-session", "secret.txt");
  await mkdir(join(sessionDir, ".context", "tool-results"), { recursive: true });
  await mkdir(join(root, "other-session"), { recursive: true });
  await writeFile(spillFile, "protected", "utf8");
  await writeFile(unrelatedFile, "secret", "utf8");

  await executeText(tools.write!, { path: workspaceFile, content: "generated" });
  expect(await readFile(workspaceFile, "utf8")).toBe("generated");

  expect(await executeText(tools.read!, { path: spillFile })).toContain("protected");
  expect(await executeText(tools.write!, { path: spillFile, content: "tampered" }))
    .toContain("outside the session working directory");
  expect(await readFile(spillFile, "utf8")).toBe("protected");

  expect(await executeText(tools.read!, { path: unrelatedFile }))
    .toContain("outside the session working directory");
});
