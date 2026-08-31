import { describe, expect, it } from "vitest";
import { mkdtempSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import crypto from "node:crypto";

import { persistSpacesAttachmentIfMarker } from "../src/mcp.js";
import { parseSubagentArtifact, renderSubagentArtifacts } from "../src/subagent-tools.js";

describe("spaces attachment persistence", () => {
  it("writes a spaces-fetch-attachment marker to .context and returns a forwardable file marker", async () => {
    const workspace = mkdtempSync(path.join(tmpdir(), "claw-artifact-"));
    const bytes = Buffer.from("png bytes");
    const result = await persistSpacesAttachmentIfMarker(
      workspace,
      `[SPACES_ATTACHMENT:shot.png:image/png]\n${bytes.toString("base64")}`,
    );

    expect(result).toContain("Saved attachment to `.context/shot.png` (image, 9 bytes)");
    expect(result).toContain("Workspace file marker: {{file:.context/shot.png}}");
    expect(result).toContain(`"sha256":"${crypto.createHash("sha256").update(bytes).digest("hex")}"`);
    expect(existsSync(path.join(workspace, ".context", "shot.png"))).toBe(true);
    expect(readFileSync(path.join(workspace, ".context", "shot.png"))).toEqual(bytes);
  });

  it("ignores ordinary tool output", async () => {
    const workspace = mkdtempSync(path.join(tmpdir(), "claw-artifact-"));
    await expect(persistSpacesAttachmentIfMarker(workspace, "hello")).resolves.toBeNull();
  });
});

describe("subagent artifact appendix", () => {
  it("extracts deterministic artifact metadata from a child spaces-fetch-attachment result", () => {
    const sha = "a".repeat(64);
    const artifact = parseSubagentArtifact(
      "Xyne_Spaces__spaces-fetch-attachment",
      [
        "Saved attachment to `.context/shot.png` (image, 9 bytes). Use the read tool to view it.",
        "Workspace file marker: {{file:.context/shot.png}}",
        `Attachment metadata: ${JSON.stringify({ fileName: "shot.png", mimeType: "image/png", sha256: sha })}`,
      ].join("\n"),
    );

    expect(artifact).toEqual({
      relPath: ".context/shot.png",
      marker: "{{file:.context/shot.png}}",
      fileName: "shot.png",
      mimeType: "image/png",
      sha256: sha,
    });
  });

  it("renders a parent-visible machine marker and file-forwarding marker", () => {
    const sha = "b".repeat(64);
    const text = renderSubagentArtifacts([
      {
        relPath: ".context/a b.png",
        marker: "{{file:.context/a b.png}}",
        fileName: "a b.png",
        mimeType: "image/png",
        sha256: sha,
      },
    ]);

    expect(text).toContain("[SUBAGENT_ARTIFACT:spaces:bbbbbbbbbbbbbbbb:a+b.png:image%2Fpng]");
    expect(text).toContain("marker=`{{file:.context/a b.png}}`");
    expect(text).toContain(`sha256=\`${sha}\``);
  });
});
