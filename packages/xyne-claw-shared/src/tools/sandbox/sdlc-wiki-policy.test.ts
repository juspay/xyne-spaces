import { describe, expect, it } from "vitest";
import {
  classifyWikiCommitRelevance,
  parseWikiNameStatus,
  wikiExcludedPathKind,
} from "./sdlc-wiki-policy.js";

describe("SDLC Wiki deterministic relevance policy", () => {
  it.each([
    ["src/service.test.ts", "test"],
    ["tests/service.ts", "test"],
    ["src/generated/client.ts", "generated"],
    ["src/schema.generated.ts", "generated"],
    ["pnpm-lock.yaml", "lockfile"],
    ["packages\\api\\__tests__\\route.ts", "test"],
  ])("classifies %s as %s", (path, expected) => {
    expect(wikiExcludedPathKind(path)).toBe(expected);
  });

  it.each([
    [[{ status: "M", paths: ["src/service.test.ts"] }], "TEST_ONLY"],
    [[{ status: "M", paths: ["dist/client.js"] }], "GENERATED_ONLY"],
    [[{ status: "M", paths: ["package-lock.json"] }], "LOCKFILE_ONLY"],
    [
      [
        { status: "M", paths: ["src/service.test.ts"] },
        { status: "M", paths: ["pnpm-lock.yaml"] },
      ],
      "MIXED_EXCLUDED_ONLY",
    ],
  ])("marks excluded paths as provable no-op", (files, reason) => {
    expect(classifyWikiCommitRelevance(files)).toEqual({ provableNoop: true, reason });
  });

  it("does not skip a commit containing source code", () => {
    expect(
      classifyWikiCommitRelevance([
        { status: "M", paths: ["src/service.test.ts"] },
        { status: "M", paths: ["src/service.ts"] },
      ]),
    ).toEqual({ provableNoop: false, reason: null });
  });

  it("does not classify an empty changed-file list as a no-op", () => {
    expect(classifyWikiCommitRelevance([])).toEqual({ provableNoop: false, reason: null });
  });

  it("preserves both paths for renames and single paths for other statuses", () => {
    expect(parseWikiNameStatus("R100\told.ts\tnew.ts\nD\tgone.ts\nM\timage.png\n")).toEqual([
      { status: "R100", paths: ["old.ts", "new.ts"] },
      { status: "D", paths: ["gone.ts"] },
      { status: "M", paths: ["image.png"] },
    ]);
  });
});
