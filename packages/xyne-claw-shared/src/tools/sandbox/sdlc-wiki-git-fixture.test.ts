import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { parseWikiNameStatus } from "./sdlc-wiki-policy.js";

const fixtures: string[] = [];

function git(repo: string, ...args: string[]): string {
  return execFileSync("git", ["-C", repo, ...args], { encoding: "utf8" }).trimEnd();
}

function fixtureRepo(): string {
  const repo = mkdtempSync(join(tmpdir(), "sdlc-wiki-git-"));
  fixtures.push(repo);
  git(repo, "init", "-b", "main");
  git(repo, "config", "user.name", "Wiki Fixture");
  git(repo, "config", "user.email", "wiki-fixture@example.invalid");
  return repo;
}

function commitAll(repo: string, message: string): string {
  git(repo, "add", "-A");
  git(repo, "commit", "-m", message);
  return git(repo, "rev-parse", "HEAD");
}

afterEach(() => {
  for (const fixture of fixtures.splice(0)) rmSync(fixture, { recursive: true, force: true });
});

describe("SDLC Wiki historical Git fixtures", () => {
  it("returns a root-to-head first-parent chain that excludes a merged side commit", () => {
    const repo = fixtureRepo();
    writeFileSync(join(repo, "root.ts"), "export const root = true;\n");
    const root = commitAll(repo, "root");

    git(repo, "checkout", "-b", "side");
    writeFileSync(join(repo, "side.ts"), "export const side = true;\n");
    const side = commitAll(repo, "side");

    git(repo, "checkout", "main");
    writeFileSync(join(repo, "main.ts"), "export const main = true;\n");
    const main = commitAll(repo, "main");
    git(repo, "merge", "--no-ff", "side", "-m", "merge side");
    const merge = git(repo, "rev-parse", "HEAD");

    const chain = git(repo, "rev-list", "--first-parent", "--reverse", "HEAD").split("\n");
    expect(chain).toEqual([root, main, merge]);
    expect(chain).not.toContain(side);
  });

  it("preserves rename/delete/binary status and produces a bounded large-diff candidate", () => {
    const repo = fixtureRepo();
    mkdirSync(join(repo, "src"));
    writeFileSync(join(repo, "src", "old.ts"), "export const value = 1;\n");
    commitAll(repo, "add source");

    renameSync(join(repo, "src", "old.ts"), join(repo, "src", "new.ts"));
    const renamed = commitAll(repo, "rename source");
    expect(
      parseWikiNameStatus(
        git(repo, "show", "--first-parent", "--format=", "--name-status", "--find-renames", renamed),
      ),
    ).toEqual([{ status: "R100", paths: ["src/old.ts", "src/new.ts"] }]);

    rmSync(join(repo, "src", "new.ts"));
    const deleted = commitAll(repo, "delete source");
    expect(
      parseWikiNameStatus(
        git(repo, "show", "--first-parent", "--format=", "--name-status", "--find-renames", deleted),
      ),
    ).toEqual([{ status: "D", paths: ["src/new.ts"] }]);

    writeFileSync(join(repo, "asset.bin"), Buffer.from([0, 1, 2, 3, 0, 255]));
    const binary = commitAll(repo, "add binary");
    expect(git(repo, "show", "--format=", "--numstat", binary)).toContain("-\t-\tasset.bin");

    writeFileSync(join(repo, "large.txt"), `${"history context line\n".repeat(32_000)}`);
    const large = commitAll(repo, "add large source");
    expect(Buffer.byteLength(git(repo, "show", "--format=fuller", "--stat", "--patch", large))).toBeGreaterThan(
      500_000,
    );
  });
});
