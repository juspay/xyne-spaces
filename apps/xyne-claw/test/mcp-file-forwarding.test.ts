import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { readWorkspaceFile, injectForwardedFiles } from "../src/mcp.js";

// Inbound MCP file forwarding: the agent references a workspace file via a
// `{{file:<relpath>}}` marker; for allowlisted servers we read the file and
// substitute its base64 into the tool param. These tests pin the two
// security-critical properties — substitution works, and resolution is
// confined to the session workspace (no traversal / symlink escape).

let workspaceDir: string;
let outsideDir: string;

beforeEach(() => {
  workspaceDir = mkdtempSync(path.join(tmpdir(), "claw-ws-"));
  outsideDir = mkdtempSync(path.join(tmpdir(), "claw-secret-"));
  mkdirSync(path.join(workspaceDir, ".context"), { recursive: true });
  writeFileSync(path.join(workspaceDir, ".context", "report.txt"), "hello world");
  writeFileSync(path.join(outsideDir, "secret.txt"), "TOP SECRET");
});

describe("readWorkspaceFile", () => {
  it("reads a file inside the workspace", async () => {
    const buf = await readWorkspaceFile(workspaceDir, ".context/report.txt");
    expect(buf.toString("utf-8")).toBe("hello world");
  });

  it("rejects absolute paths", async () => {
    await expect(
      readWorkspaceFile(workspaceDir, path.join(outsideDir, "secret.txt")),
    ).rejects.toThrow(/absolute paths/i);
  });

  it("rejects `..` traversal outside the workspace", async () => {
    await expect(
      readWorkspaceFile(workspaceDir, "../" + path.basename(outsideDir) + "/secret.txt"),
    ).rejects.toThrow(/outside the workspace|no such file|ENOENT/i);
  });

  it("rejects a symlink that escapes the workspace", async () => {
    symlinkSync(path.join(outsideDir, "secret.txt"), path.join(workspaceDir, "link.txt"));
    await expect(readWorkspaceFile(workspaceDir, "link.txt")).rejects.toThrow(
      /outside the workspace/i,
    );
  });
});

describe("injectForwardedFiles", () => {
  it("replaces a `{{file:...}}` marker with base64 content", async () => {
    const { params, forwarded } = await injectForwardedFiles(
      { path: "{{file:.context/report.txt}}", note: "keep me" },
      workspaceDir,
    );
    expect(forwarded).toEqual([".context/report.txt"]);
    expect(params["path"]).toBe(Buffer.from("hello world").toString("base64"));
    expect(params["note"]).toBe("keep me");
  });

  it("recurses into nested objects and arrays", async () => {
    const { params, forwarded } = await injectForwardedFiles(
      { files: [{ content: "{{file:.context/report.txt}}" }] },
      workspaceDir,
    );
    expect(forwarded.length).toBe(1);
    const files = params["files"] as Array<{ content: string }>;
    expect(files[0]!.content).toBe(Buffer.from("hello world").toString("base64"));
  });

  it("leaves params without a marker untouched", async () => {
    const input = { a: "plain", b: 42, c: true };
    const { params, forwarded } = await injectForwardedFiles(input, workspaceDir);
    expect(forwarded).toEqual([]);
    expect(params).toEqual(input);
  });

  it("propagates the error when a marker points outside the workspace", async () => {
    await expect(
      injectForwardedFiles({ p: "{{file:../" + path.basename(outsideDir) + "/secret.txt}}" }, workspaceDir),
    ).rejects.toThrow();
  });
});
