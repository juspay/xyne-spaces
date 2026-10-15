import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readDeployedTemplateNames } from "./sandbox-templates.js";

describe("readDeployedTemplateNames", () => {
  it("takes SandboxTemplate names from nested yaml and skips other kinds and rotation variants", async () => {
    const dir = await mkdtemp(join(tmpdir(), "kata-infra-"));
    await mkdir(join(dir, "euler"));
    await writeFile(
      join(dir, "02-sandbox-template.yaml"),
      "kind: SandboxTemplate\nmetadata:\n  name: kata-workspace-template\n---\nkind: SandboxWarmPool\nmetadata:\n  name: pool\n",
    );
    await writeFile(join(dir, "euler", "05-sandbox-template-euler.yaml"), "kind: SandboxTemplate\nmetadata:\n  name: euler-workspace-template\n");
    await writeFile(join(dir, "10-gvisor-a.yaml"), "kind: SandboxTemplate\nmetadata:\n  name: agent-workspace-gvisor-template-a\n");
    await writeFile(join(dir, "README.md"), "kind: SandboxTemplate");

    expect((await readDeployedTemplateNames(dir)).sort()).toEqual(["euler-workspace-template", "kata-workspace-template"]);
  });
});
