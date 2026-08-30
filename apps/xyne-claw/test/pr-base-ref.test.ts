import { describe, expect, it } from "vitest";

import { collectPrEvidence, type GitRunner } from "../src/pr-evidence.js";
import { resolveBaseRef } from "../src/pr-review-room.js";

function makeGit(handler: (args: string[]) => { ok: boolean; stdout?: string; stderr?: string }): {
  git: GitRunner;
  calls: string[][];
} {
  const calls: string[][] = [];
  const git: GitRunner = async (args) => {
    calls.push(args);
    const r = handler(args);
    return { ok: r.ok, stdout: r.stdout ?? "", stderr: r.stderr ?? "", exitCode: r.ok ? 0 : 1 };
  };
  return { git, calls };
}

describe("resolveBaseRef", () => {
  it("prefers the PR target branch over origin/main", async () => {
    const { git } = makeGit((args) => {
      if (args[0] === "rev-parse" && args[3] === "origin/feature/deploy-xyneclaw") {
        return { ok: true, stdout: "abc123\n" };
      }
      if (args[0] === "rev-parse") return { ok: true, stdout: "def456\n" };
      return { ok: true, stdout: "" };
    });
    expect(await resolveBaseRef(git, "feature/deploy-xyneclaw")).toBe("origin/feature/deploy-xyneclaw");
  });

  it("fetches the target branch once when it is not present locally", async () => {
    let fetched = false;
    const { git, calls } = makeGit((args) => {
      if (args[0] === "fetch") {
        fetched = true;
        return { ok: true, stdout: "" };
      }
      if (args[0] === "rev-parse" && args[3] === "origin/release-1") {
        return fetched ? { ok: true, stdout: "abc\n" } : { ok: true, stdout: "" };
      }
      return { ok: true, stdout: "" };
    });
    expect(await resolveBaseRef(git, "release-1")).toBe("origin/release-1");
    expect(calls.filter((c) => c[0] === "fetch")).toHaveLength(1);
  });

  it("falls back to develop when no main/master exists", async () => {
    const { git } = makeGit((args) => {
      if (args[0] === "symbolic-ref") return { ok: false };
      if (args[0] === "rev-parse" && args[3] === "origin/develop") return { ok: true, stdout: "aaa\n" };
      return { ok: true, stdout: "" };
    });
    expect(await resolveBaseRef(git)).toBe("origin/develop");
  });

  it("returns undefined when nothing resolves", async () => {
    const { git } = makeGit(() => ({ ok: true, stdout: "" }));
    expect(await resolveBaseRef(git)).toBeUndefined();
  });

  it("strips an origin/ prefix and rejects unusable branch names", async () => {
    const { git } = makeGit((args) => {
      if (args[0] === "rev-parse" && args[3] === "origin/main") return { ok: true, stdout: "aaa\n" };
      if (args[0] === "symbolic-ref") return { ok: false };
      return { ok: true, stdout: "" };
    });
    expect(await resolveBaseRef(git, "origin/main")).toBe("origin/main");
    expect(await resolveBaseRef(git, "  ")).toBe("origin/main");
  });
});

describe("collectPrEvidence diff failure", () => {
  const baseArgs = { repoRoot: "/workspace/repo", baseRef: "origin/main", headRef: "HEAD" };

  it("reports diffFailure when the diff command fails", async () => {
    const { git } = makeGit((args) => {
      if (args[0] === "diff" && args[1] === "--name-status") {
        return { ok: false, stderr: "fatal: bad revision" };
      }
      if (args[0] === "rev-parse") return { ok: true, stdout: "head1\n" };
      if (args[0] === "merge-base") return { ok: true, stdout: "base1\n" };
      return { ok: true, stdout: "" };
    });
    const evidence = await collectPrEvidence({ git, ...baseArgs });
    expect(evidence.diffFailure).toContain("fatal: bad revision");
    expect(evidence.filesChanged).toBe(0);
  });

  it("leaves diffFailure unset for a genuinely empty diff", async () => {
    const { git } = makeGit((args) => {
      if (args[0] === "rev-parse") return { ok: true, stdout: "head1\n" };
      if (args[0] === "merge-base") return { ok: true, stdout: "base1\n" };
      return { ok: true, stdout: "" };
    });
    const evidence = await collectPrEvidence({ git, ...baseArgs });
    expect(evidence.diffFailure).toBeUndefined();
    expect(evidence.filesChanged).toBe(0);
  });
});
