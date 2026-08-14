import { describe, it, expect } from "vitest";
import {
  normalizeSkillContent,
  hashSkillContent,
  skillHashEquals,
  computeSkillDiff,
  formatSkillDiffForCard,
  resolveSkillUpdateApprover,
  authorizeSkillUpdateApproval,
  authorizeSkillFileUpdate,
} from "./index.js";

describe("normalizeSkillContent", () => {
  it("normalizes CRLF, trailing whitespace and outer blank lines", () => {
    expect(normalizeSkillContent("a\r\nb  \r\n\r\n")).toBe("a\nb");
    expect(normalizeSkillContent("  x\ty \n")).toBe("x\ty"); // outer whitespace trimmed, inner trailing stripped
  });
});

describe("hashSkillContent / skillHashEquals", () => {
  it("is stable across CRLF and trailing-newline noise", () => {
    expect(hashSkillContent("hello\nworld")).toBe(hashSkillContent("hello\r\nworld\n"));
  });
  it("changes when content changes", () => {
    expect(hashSkillContent("a")).not.toBe(hashSkillContent("b"));
  });
  it("is a 64-char hex sha256", () => {
    expect(hashSkillContent("x")).toMatch(/^[0-9a-f]{64}$/);
  });
  it("skillHashEquals is true for equal, false for different / malformed", () => {
    const h = hashSkillContent("same");
    expect(skillHashEquals(h, hashSkillContent("same"))).toBe(true);
    expect(skillHashEquals(h, hashSkillContent("other"))).toBe(false);
    expect(skillHashEquals(h, "")).toBe(false);
    // @ts-expect-error deliberate wrong type
    expect(skillHashEquals(h, null)).toBe(false);
  });
});

describe("computeSkillDiff", () => {
  it("reports no changes for identical (post-normalization) content", () => {
    const d = computeSkillDiff("line1\nline2", "line1\r\nline2\n");
    expect(d.hasChanges).toBe(false);
    expect(d.unified).toBe("");
    expect(d.added).toBe(0);
    expect(d.removed).toBe(0);
  });

  it("counts added and removed lines", () => {
    const oldC = "a\nb\nc";
    const newC = "a\nB\nc\nd";
    const d = computeSkillDiff(oldC, newC);
    expect(d.hasChanges).toBe(true);
    // b -> B is a delete + add; d is an add
    expect(d.added).toBe(2);
    expect(d.removed).toBe(1);
    expect(d.unified).toContain("-b");
    expect(d.unified).toContain("+B");
    expect(d.unified).toContain("+d");
    expect(d.unified).toContain("@@");
  });

  it("emits unified headers and context lines", () => {
    const oldC = Array.from({ length: 10 }, (_, i) => `l${i}`).join("\n");
    const newC = oldC.replace("l5", "l5-changed");
    const d = computeSkillDiff(oldC, newC, { context: 2 });
    expect(d.unified).toMatch(/^--- a\/SKILL\.md/m);
    expect(d.unified).toMatch(/^\+\+\+ b\/SKILL\.md/m);
    expect(d.unified).toMatch(/@@ -\d+,\d+ \+\d+,\d+ @@/);
    expect(d.unified).toContain(" l3"); // context around the change
    expect(d.unified).toContain("-l5");
    expect(d.unified).toContain("+l5-changed");
    // far-away lines are NOT included with context=2
    expect(d.unified).not.toContain(" l0");
  });

  it("handles pure addition to empty content", () => {
    const d = computeSkillDiff("", "new line");
    expect(d.hasChanges).toBe(true);
    expect(d.added).toBe(1);
    expect(d.removed).toBe(0);
    expect(d.unified).toContain("+new line");
  });
});

describe("formatSkillDiffForCard", () => {
  it("wraps in a fenced diff block with +/- stats", () => {
    const d = computeSkillDiff("a", "b");
    const card = formatSkillDiffForCard(d);
    expect(card).toContain("```diff");
    expect(card).toContain("+1");
    expect(card).toContain("-1");
  });
  it("truncates very large diffs", () => {
    const big = Array.from({ length: 5000 }, (_, i) => `line ${i}`).join("\n");
    const d = computeSkillDiff("", big);
    const card = formatSkillDiffForCard(d, { maxChars: 500 });
    expect(card).toContain("diff truncated");
    expect(card.length).toBeLessThan(700);
  });
  it("says no changes when identical", () => {
    expect(formatSkillDiffForCard(computeSkillDiff("x", "x"))).toBe("_No changes._");
  });
});

describe("resolveSkillUpdateApprover", () => {
  it("routes personal skills to the owner (no admin required)", () => {
    const r = resolveSkillUpdateApprover({ scope: "personal", ownerUserId: "u1" });
    expect(r).toEqual({ ok: true, approverUserId: "u1", requiresAdmin: false });
  });
  it("requires admin for global skills, notifying owner/promoter", () => {
    const r = resolveSkillUpdateApprover({ scope: "global", ownerUserId: null, promotedBy: "admin1" });
    expect(r.ok).toBe(true);
    expect(r.approverUserId).toBe("admin1");
    expect(r.requiresAdmin).toBe(true);
  });
  it("fails for personal skill with no owner", () => {
    const r = resolveSkillUpdateApprover({ scope: "personal", ownerUserId: null });
    expect(r.ok).toBe(false);
    expect(r.requiresAdmin).toBe(false);
  });
  it("fails for global skill with no owner or promoter", () => {
    const r = resolveSkillUpdateApprover({ scope: "global", ownerUserId: null, promotedBy: null });
    expect(r.ok).toBe(false);
    expect(r.requiresAdmin).toBe(true);
  });
});

describe("authorizeSkillUpdateApproval", () => {
  const base = { currentContentHash: "h", baseContentHash: "h" };

  it("allows the designated owner", () => {
    expect(authorizeSkillUpdateApproval({ ...base, approverUserId: "u1", requiresAdmin: false, callerUserId: "u1", callerIsAdmin: false })).toEqual({ ok: true });
  });
  it("rejects a non-owner non-admin caller (403)", () => {
    const r = authorizeSkillUpdateApproval({ ...base, approverUserId: "u1", requiresAdmin: false, callerUserId: "attacker", callerIsAdmin: false });
    expect(r).toEqual({ ok: false, code: 403, reason: expect.any(String) });
  });
  it("allows an admin to approve a personal skill", () => {
    expect(authorizeSkillUpdateApproval({ ...base, approverUserId: "u1", requiresAdmin: false, callerUserId: "admin", callerIsAdmin: true }).ok).toBe(true);
  });
  it("allows the owner/promoter to approve their own global skill (non-admin)", () => {
    const r = authorizeSkillUpdateApproval({ ...base, approverUserId: "u1", requiresAdmin: true, callerUserId: "u1", callerIsAdmin: false });
    expect(r).toEqual({ ok: true });
  });
  it("rejects a non-owner non-admin on a global (admin-gated) skill (403)", () => {
    const r = authorizeSkillUpdateApproval({ ...base, approverUserId: "u1", requiresAdmin: true, callerUserId: "attacker", callerIsAdmin: false });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe(403);
  });
  it("allows an admin on a global skill", () => {
    expect(authorizeSkillUpdateApproval({ ...base, approverUserId: "u1", requiresAdmin: true, callerUserId: "admin", callerIsAdmin: true }).ok).toBe(true);
  });
  it("returns 409 when the skill drifted since the proposal (optimistic concurrency)", () => {
    const r = authorizeSkillUpdateApproval({ approverUserId: "u1", requiresAdmin: false, callerUserId: "u1", callerIsAdmin: false, currentContentHash: "NEW", baseContentHash: "OLD" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe(409);
  });
});


describe("authorizeSkillFileUpdate", () => {
  it("allows the owner to edit their own PERSONAL skill's files (non-admin)", () => {
    expect(authorizeSkillFileUpdate({ ownerUserId: "u1", callerUserId: "u1", callerIsAdmin: false })).toEqual({ ok: true });
  });
  it("allows the owner to edit their own GLOBAL skill's files (non-admin) — the bug this fixes", () => {
    // scope is irrelevant to the file-edit ACL: ownership is what matters.
    expect(authorizeSkillFileUpdate({ ownerUserId: "u1", callerUserId: "u1", callerIsAdmin: false })).toEqual({ ok: true });
  });
  it("allows a CLAW_ADMIN to edit any skill's files, even a skill they do not own", () => {
    expect(authorizeSkillFileUpdate({ ownerUserId: "u1", callerUserId: "admin", callerIsAdmin: true })).toEqual({ ok: true });
  });
  it("rejects a non-owner non-admin caller (403)", () => {
    const r = authorizeSkillFileUpdate({ ownerUserId: "u1", callerUserId: "attacker", callerIsAdmin: false });
    expect(r).toEqual({ ok: false, code: 403, reason: expect.any(String) });
  });
  it("rejects a non-admin when the skill has no owner (403)", () => {
    const r = authorizeSkillFileUpdate({ ownerUserId: null, callerUserId: "u1", callerIsAdmin: false });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe(403);
  });
  it("allows an admin even when the skill has no owner", () => {
    expect(authorizeSkillFileUpdate({ ownerUserId: null, callerUserId: "admin", callerIsAdmin: true })).toEqual({ ok: true });
  });
});
