import { describe, expect, it } from "vitest";
import {
  diffDesignMarkdown,
  diffDesignTokens,
  formatContentChangeSummary,
  formatDiffSummary,
  type TokenDiffSummary,
} from "./design-diff.js";

/**
 * What a person approving a re-import is shown. The risk is not a crash, it is
 * a diff that says "nothing changed" about a revision that did change, or that
 * reports churn a re-extraction invented — either one trains people to click
 * through the approval, which is the only thing standing between a re-import
 * and the design system every run uses.
 */

const BASE = {
  "--brand-primary": "#2563EB",
  "--brand-text": "#0F172A",
  "--radius-md": "8px",
};

describe("diffDesignTokens", () => {
  it("reports nothing for identical sets", () => {
    const diff = diffDesignTokens(BASE, { ...BASE });
    expect(diff).toEqual<TokenDiffSummary>({
      added: [],
      changed: [],
      removed: [],
      hasChanges: false,
    });
  });

  it("reports an added token", () => {
    const diff = diffDesignTokens(BASE, { ...BASE, "--brand-accent": "#F97316" });
    expect(diff.added).toEqual([{ key: "--brand-accent", value: "#F97316" }]);
    expect(diff.changed).toEqual([]);
    expect(diff.removed).toEqual([]);
    expect(diff.hasChanges).toBe(true);
  });

  it("reports a changed token with both values", () => {
    const diff = diffDesignTokens(BASE, { ...BASE, "--brand-primary": "#1D4ED8" });
    expect(diff.changed).toEqual([
      { key: "--brand-primary", oldValue: "#2563EB", newValue: "#1D4ED8" },
    ]);
    expect(diff.added).toEqual([]);
    expect(diff.removed).toEqual([]);
  });

  it("reports a removed token with the value it had", () => {
    const { "--radius-md": _dropped, ...withoutRadius } = BASE;
    const diff = diffDesignTokens(BASE, withoutRadius);
    expect(diff.removed).toEqual([{ key: "--radius-md", value: "8px" }]);
    expect(diff.added).toEqual([]);
    expect(diff.changed).toEqual([]);
  });

  it("reports all three at once", () => {
    const diff = diffDesignTokens(BASE, {
      "--brand-primary": "#1D4ED8",
      "--brand-text": "#0F172A",
      "--brand-accent": "#F97316",
    });
    expect(diff.added.map(t => t.key)).toEqual(["--brand-accent"]);
    expect(diff.changed.map(t => t.key)).toEqual(["--brand-primary"]);
    expect(diff.removed.map(t => t.key)).toEqual(["--radius-md"]);
  });

  it("treats a reformatted value as unchanged", () => {
    // A re-extraction formats its own output. If whitespace counted, every
    // re-import would report every token as changed and the diff would be
    // useless for spotting the handful that really moved.
    const diff = diffDesignTokens(
      { "--shadow-card": "0 1px 2px rgba(0,0,0,.05)" },
      { "--shadow-card": "  0 1px   2px rgba(0,0,0,.05)  " },
    );
    expect(diff.hasChanges).toBe(false);
  });

  it("treats a case rewrite as a change, because the file really did change", () => {
    // #FFF and #fff are the same colour, but the stored tokens.css is not the
    // same text. Hiding it would let the saved version differ from the diff
    // that was approved.
    const diff = diffDesignTokens({ "--brand-bg": "#FFF" }, { "--brand-bg": "#fff" });
    expect(diff.changed).toEqual([{ key: "--brand-bg", oldValue: "#FFF", newValue: "#fff" }]);
  });

  it("calls an emptied value a change, not a removal", () => {
    // The token still exists in the file. Reporting it as removed would tell a
    // reviewer the declaration is gone when it is still there, empty.
    const diff = diffDesignTokens({ "--brand-bg": "#fff" }, { "--brand-bg": "" });
    expect(diff.changed).toEqual([{ key: "--brand-bg", oldValue: "#fff", newValue: "" }]);
    expect(diff.removed).toEqual([]);
  });

  it("does not call an already-empty token added", () => {
    const diff = diffDesignTokens({ "--brand-bg": "" }, { "--brand-bg": "" });
    expect(diff.hasChanges).toBe(false);
  });

  it("handles an empty side in both directions", () => {
    expect(diffDesignTokens({}, BASE).added).toHaveLength(3);
    expect(diffDesignTokens(BASE, {}).removed).toHaveLength(3);
    expect(diffDesignTokens({}, {}).hasChanges).toBe(false);
  });

  it("orders each list by key, so the same two revisions always read the same", () => {
    const diff = diffDesignTokens(
      {},
      { "--z-top": "9", "--a-first": "1", "--m-mid": "5" },
    );
    expect(diff.added.map(t => t.key)).toEqual(["--a-first", "--m-mid", "--z-top"]);
  });
});

describe("diffDesignMarkdown", () => {
  it("reports no changes for identical text", () => {
    const diff = diffDesignMarkdown("# Acme\n\nUse sentence case.", "# Acme\n\nUse sentence case.");
    expect(diff.hasChanges).toBe(false);
    expect(diff.unified).toBe("");
  });

  it("counts added and removed lines and shows them in a hunk", () => {
    const diff = diffDesignMarkdown(
      "# Acme\n\n## Voice\n\n- Tone: direct\n",
      "# Acme\n\n## Voice\n\n- Tone: warm\n- Avoid: synergy\n",
    );
    expect(diff.hasChanges).toBe(true);
    expect(diff.added).toBe(2);
    expect(diff.removed).toBe(1);
    expect(diff.unified).toContain("-- Tone: direct");
    expect(diff.unified).toContain("+- Tone: warm");
    expect(diff.unified).toContain("+- Avoid: synergy");
  });

  it("ignores a line-ending rewrite", () => {
    // Re-import writes its own file. A CRLF rewrite is not a change to the
    // rules, and reporting the whole document would bury a real edit.
    const diff = diffDesignMarkdown("# Acme\n\n- Tone: direct\n", "# Acme\r\n\r\n- Tone: direct\r\n");
    expect(diff.hasChanges).toBe(false);
  });

  it("returns hunks rather than the whole document", () => {
    const unchanged = Array.from({ length: 60 }, (_, i) => `- rule ${i}`).join("\n");
    const diff = diffDesignMarkdown(`${unchanged}\n- last: old`, `${unchanged}\n- last: new`);
    expect(diff.hasChanges).toBe(true);
    // Context only, not 61 lines: the point of showing a diff for approval is
    // that the reviewer can see what moved.
    expect(diff.unified.split("\n").length).toBeLessThan(15);
  });
});

describe("formatDiffSummary", () => {
  const tokens = (over: Partial<TokenDiffSummary> = {}): TokenDiffSummary => ({
    added: [],
    changed: [],
    removed: [],
    hasChanges: false,
    ...over,
  });

  it("names each non-zero part", () => {
    const summary = formatDiffSummary(
      tokens({
        added: [{ key: "--a", value: "1" }, { key: "--b", value: "2" }],
        changed: [{ key: "--c", oldValue: "1", newValue: "2" }],
        removed: [{ key: "--d", value: "4" }],
        hasChanges: true,
      }),
    );
    expect(summary).toBe("2 tokens added, 1 token changed, 1 token removed");
  });

  it("leaves out the parts that are zero", () => {
    const summary = formatDiffSummary(
      tokens({ changed: [{ key: "--c", oldValue: "1", newValue: "2" }], hasChanges: true }),
    );
    expect(summary).toBe("1 token changed");
  });

  it("includes the markdown line counts when rules moved", () => {
    const markdown = diffDesignMarkdown("- Tone: direct\n", "- Tone: warm\n- Avoid: synergy\n");
    const summary = formatDiffSummary(tokens(), markdown);
    expect(summary).toBe("+2/-1 lines of rules");
  });

  it("says line, singular, when exactly one moved", () => {
    const markdown = diffDesignMarkdown("- Tone: direct\n", "- Tone: direct\n- Avoid: synergy\n");
    expect(formatDiffSummary(tokens(), markdown)).toBe("+1 line of rules");
  });

  it("omits the markdown part when the rules are identical", () => {
    const markdown = diffDesignMarkdown("- Tone: direct\n", "- Tone: direct\n");
    const summary = formatDiffSummary(
      tokens({ added: [{ key: "--a", value: "1" }], hasChanges: true }),
      markdown,
    );
    expect(summary).toBe("1 token added");
  });

  it("says so out loud when nothing moved", () => {
    // This lands in a version row. Empty there reads as missing data.
    expect(formatDiffSummary(tokens())).toBe("No changes");
  });
});

describe("formatContentChangeSummary", () => {
  const files = (over: Partial<Parameters<typeof formatContentChangeSummary>[0]> = {}) => ({
    oldDesignMd: "# Acme\n",
    newDesignMd: "# Acme\n",
    oldTokensCss: ":root{\n--a: 1;\n}\n",
    newTokensCss: ":root{\n--a: 1;\n}\n",
    ...over,
  });

  it("names both files when both moved", () => {
    expect(
      formatContentChangeSummary(
        files({
          newDesignMd: "# Acme\n\n- Tone: warm\n",
          newTokensCss: ":root{\n--a: 2;\n--b: 3;\n}\n",
        }),
      ),
    ).toBe("tokens.css +2/-1 lines, DESIGN.md +2 lines");
  });

  it("names only the file that moved", () => {
    expect(formatContentChangeSummary(files({ newTokensCss: ":root{\n--a: 2;\n}\n" }))).toBe(
      "tokens.css +1/-1 lines",
    );
    expect(formatContentChangeSummary(files({ newDesignMd: "# Acme\n- new\n" }))).toBe(
      "DESIGN.md +1 line",
    );
  });

  it("stays bounded on the largest token CSS the routes accept", () => {
    // 64k characters of short lines is ~16k lines a side. Diffing that line by
    // line is a 256M-cell table: seconds of CPU and gigabytes of memory, in a
    // request, on a pod shared by every org. Measured on the unguarded differ,
    // 8k lines a side already cost 518ms and 614MB.
    const lines = 16_000;
    const before = Array.from({ length: lines }, (_, i) => `--a${i}:1;`).join("\n");
    const after = Array.from({ length: lines }, (_, i) => `--a${i}:2;`).join("\n");
    expect(before.length).toBeGreaterThan(64_000 * 0.9);

    const started = Date.now();
    const summary = formatContentChangeSummary({
      oldDesignMd: "# x",
      newDesignMd: "# x",
      oldTokensCss: before,
      newTokensCss: after,
    });
    const elapsed = Date.now() - started;

    // Says what moved in sizes rather than per-line counts, which is the honest
    // answer when the comparison was refused.
    expect(summary).toBe("tokens.css changed (16000 → 16000 lines)");
    expect(elapsed).toBeLessThan(1_000);
  });

  it("stays honest when only the assets changed", () => {
    // An assets-only edit is still a new version, and claiming a file moved
    // would be a lie the history cannot back up.
    expect(formatContentChangeSummary(files())).toBe("No changes to DESIGN.md or tokens.css");
  });
});
