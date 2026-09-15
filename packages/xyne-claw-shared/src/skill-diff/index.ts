/**
 * Skill diffing + content-integrity helpers (pure, dependency-free).
 *
 * Used by the `create-skill` / `update-skill` custom tools and by
 * xyne-claw-auth's skill change-request flow:
 *
 *   - `hashSkillContent` produces a stable SHA-256 over the NORMALIZED content
 *     so a proposed update can be pinned to the exact base it was computed
 *     against (optimistic-concurrency guard) and verified before it is
 *     persisted (tamper guard on the signed/stored request).
 *   - `computeSkillDiff` produces a real unified diff (with hunks + context)
 *     so the owner-approval DM card shows ONLY what changed, not the whole file.
 *
 * No third-party deps on purpose — xyne-claw-shared is imported by both
 * xyne-claw (agent runtime) and xyne-claw-auth, and this module must stay
 * trivially portable + unit-testable.
 */

import crypto from "node:crypto";

/**
 * Canonicalize skill content before hashing/diffing.
 *
 * The skills route persists `content.trim()`, and content can arrive with
 * CRLF or a trailing newline depending on the editor. Normalizing here means
 * the base hash the tool computes matches the hash claw-auth recomputes from
 * the persisted row — otherwise every update would spuriously 409 on the
 * optimistic-concurrency check.
 */
export function normalizeSkillContent(content: string): string {
  return content.replace(/\r\n/g, "\n").replace(/\r/g, "\n").replace(/[ \t]+$/gm, "").trim();
}

/** Stable SHA-256 (hex) over the normalized content. */
export function hashSkillContent(content: string): string {
  return crypto.createHash("sha256").update(normalizeSkillContent(content), "utf8").digest("hex");
}

/** Constant-time equality for two hex hashes (avoids early-exit timing leaks). */
export function skillHashEquals(a: string, b: string): boolean {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(a, "utf8"), Buffer.from(b, "utf8"));
  } catch {
    return false;
  }
}

/** One rendered diff line for structured (git-style) card rendering. */
export interface SkillDiffLine {
  kind: "ctx" | "add" | "del";
  text: string;
}

/** One hunk, both as a unified header and as structured lines. */
export interface SkillDiffHunk {
  /** e.g. `@@ -350,19 +350,4 @@` */
  header: string;
  lines: SkillDiffLine[];
}

export interface SkillDiff {
  /** Unified-diff text (hunks with `@@`, ` `/`+`/`-` prefixes). Empty when identical. */
  unified: string;
  /** Structured hunks — same data as `unified`, for git-style card rendering. */
  hunks: SkillDiffHunk[];
  /** Number of added lines. */
  added: number;
  /** Number of removed lines. */
  removed: number;
  /** True when the two contents differ after normalization. */
  hasChanges: boolean;
}

type EditOp = { kind: "eq" | "add" | "del"; line: string };

/**
 * Line-level LCS (dynamic programming). Skill markdown is small (well under a
 * few thousand lines), so the O(n*m) table is fine and keeps the code simple
 * and obviously-correct versus a hand-rolled Myers implementation.
 */
function lcsEditScript(oldLines: string[], newLines: string[]): EditOp[] {
  const n = oldLines.length;
  const m = newLines.length;
  // dp[i][j] = LCS length of oldLines[i..] and newLines[j..]
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i]![j] = oldLines[i] === newLines[j]
        ? dp[i + 1]![j + 1]! + 1
        : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
    }
  }
  const ops: EditOp[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (oldLines[i] === newLines[j]) {
      ops.push({ kind: "eq", line: oldLines[i]! });
      i++; j++;
    } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) {
      ops.push({ kind: "del", line: oldLines[i]! });
      i++;
    } else {
      ops.push({ kind: "add", line: newLines[j]! });
      j++;
    }
  }
  while (i < n) ops.push({ kind: "del", line: oldLines[i++]! });
  while (j < m) ops.push({ kind: "add", line: newLines[j++]! });
  return ops;
}

/**
 * Produce a unified diff (default 3 lines of context) between two skill
 * bodies. Returns empty `unified` with `hasChanges:false` when they are
 * identical after normalization.
 */
export function computeSkillDiff(
  oldContent: string,
  newContent: string,
  opts?: { context?: number; oldLabel?: string; newLabel?: string },
): SkillDiff {
  const context = Math.max(0, opts?.context ?? 3);
  const oldNorm = normalizeSkillContent(oldContent);
  const newNorm = normalizeSkillContent(newContent);
  if (oldNorm === newNorm) {
    return { unified: "", hunks: [], added: 0, removed: 0, hasChanges: false };
  }
  const oldLines = oldNorm.length ? oldNorm.split("\n") : [];
  const newLines = newNorm.length ? newNorm.split("\n") : [];
  const ops = lcsEditScript(oldLines, newLines);

  let added = 0;
  let removed = 0;
  for (const op of ops) {
    if (op.kind === "add") added++;
    else if (op.kind === "del") removed++;
  }

  // Group ops into hunks: any run of changes plus `context` equal lines on
  // each side. Equal runs longer than 2*context split hunks apart.
  interface Hunk { oldStart: number; oldLen: number; newStart: number; newLen: number; lines: string[]; }
  const hunks: Hunk[] = [];
  let cur: Hunk | null = null;
  let oldNo = 0; // 0-based index into oldLines
  let newNo = 0;
  let trailingEq = 0;

  const flush = () => {
    if (cur) { hunks.push(cur); cur = null; trailingEq = 0; }
  };

  for (let k = 0; k < ops.length; k++) {
    const op = ops[k]!;
    if (op.kind === "eq") {
      if (cur) {
        if (trailingEq < context) {
          cur.lines.push(" " + op.line);
          cur.oldLen++; cur.newLen++;
          trailingEq++;
        } else {
          // enough trailing context collected; look ahead — if another change
          // is within `context` lines, keep the hunk open, else flush.
          let nextChange = -1;
          for (let t = k; t < ops.length && t < k + context; t++) {
            if (ops[t]!.kind !== "eq") { nextChange = t; break; }
          }
          if (nextChange === -1) { flush(); } else { cur.lines.push(" " + op.line); cur.oldLen++; cur.newLen++; }
        }
      }
      oldNo++; newNo++;
    } else {
      if (!cur) {
        // open a new hunk, back-filling up to `context` preceding equal lines.
        const back = Math.min(context, /* preceding eq lines already consumed */ (() => {
          let c = 0;
          for (let t = k - 1; t >= 0 && ops[t]!.kind === "eq" && c < context; t--) c++;
          return c;
        })());
        const startOld = oldNo - back;
        const startNew = newNo - back;
        cur = { oldStart: startOld, oldLen: 0, newStart: startNew, newLen: 0, lines: [] };
        for (let b = back; b > 0; b--) {
          const eqLine = ops[k - b]!.line;
          cur.lines.push(" " + eqLine);
          cur.oldLen++; cur.newLen++;
        }
      }
      trailingEq = 0;
      if (op.kind === "add") { cur.lines.push("+" + op.line); cur.newLen++; newNo++; }
      else { cur.lines.push("-" + op.line); cur.oldLen++; oldNo++; }
    }
  }
  flush();

  const oldLabel = opts?.oldLabel ?? "a/SKILL.md";
  const newLabel = opts?.newLabel ?? "b/SKILL.md";
  const out: string[] = [`--- ${oldLabel}`, `+++ ${newLabel}`];
  const structured: SkillDiffHunk[] = [];
  for (const h of hunks) {
    // unified headers are 1-based; a 0-length side reports start 0.
    const oStart = h.oldLen === 0 ? h.oldStart : h.oldStart + 1;
    const nStart = h.newLen === 0 ? h.newStart : h.newStart + 1;
    const header = `@@ -${oStart},${h.oldLen} +${nStart},${h.newLen} @@`;
    out.push(header);
    out.push(...h.lines);
    structured.push({
      header,
      lines: h.lines.map((l): SkillDiffLine => ({
        kind: l.startsWith("+") ? "add" : l.startsWith("-") ? "del" : "ctx",
        text: l.slice(1),
      })),
    });
  }
  return { unified: out.join("\n"), hunks: structured, added, removed, hasChanges: true };
}

/**
 * Wrap a computed diff in a fenced ```diff code block for the flow card's
 * TextNode (which renders fenced blocks monospaced). Truncates very large
 * diffs so a runaway rewrite can't blow out the chat surface.
 */
export function formatSkillDiffForCard(diff: SkillDiff, opts?: { maxChars?: number }): string {
  const maxChars = opts?.maxChars ?? 6000;
  if (!diff.hasChanges) return "_No changes._";
  let body = diff.unified;
  let truncated = false;
  if (body.length > maxChars) {
    body = body.slice(0, maxChars);
    truncated = true;
  }
  const fence = "```diff\n" + body + "\n```";
  const stats = `_+${diff.added} / -${diff.removed}${truncated ? " · diff truncated" : ""}_`;
  return `${stats}\n${fence}`;
}

// ── Approver resolution + authorization (pure) ───────────────────────────────

export interface SkillForAuthz {
  scope: string;
  ownerUserId: string | null;
  promotedBy?: string | null;
}

export interface ApproverResolution {
  ok: boolean;
  approverUserId?: string;
  /** True when the change must be approved by a CLAW_ADMIN (global skills). */
  requiresAdmin: boolean;
  reason?: string;
}

/**
 * Decide who must approve an `update-skill` proposal, and whether admin rights
 * are required.
 *
 *   personal skill → the owner approves (DM goes to the owner).
 *   global skill   → the recorded owner/promoter OR any admin may approve. The
 *                    DM is routed to the owner/promoter as the notify target,
 *                    and the resolve step accepts that owner or a CLAW_ADMIN.
 */
export function resolveSkillUpdateApprover(skill: SkillForAuthz): ApproverResolution {
  if (skill.scope === "global") {
    const notify = skill.ownerUserId ?? skill.promotedBy ?? null;
    if (!notify) {
      return { ok: false, requiresAdmin: true, reason: "global skill has no owner/promoter to notify; an admin must edit it directly" };
    }
    return { ok: true, approverUserId: notify, requiresAdmin: true };
  }
  if (!skill.ownerUserId) {
    return { ok: false, requiresAdmin: false, reason: "skill has no owner to approve the change" };
  }
  return { ok: true, approverUserId: skill.ownerUserId, requiresAdmin: false };
}

export type SkillApprovalAuthz = { ok: true } | { ok: false; code: 403 | 409; reason: string };

/**
 * Authorize a caller clicking Approve/Decline on a skill-update request.
 * Server-side callers MUST pass the values re-fetched from the DB (the request
 * row + the live skill), never values echoed from the flow card.
 */
export function authorizeSkillUpdateApproval(params: {
  /** approverUserId stored on the change request (source of truth). */
  approverUserId: string;
  /** True when the request targets a global skill (admin-gated). */
  requiresAdmin: boolean;
  callerUserId: string;
  callerIsAdmin: boolean;
  /** Hash of the skill's CURRENT content (re-read now). */
  currentContentHash: string;
  /** Hash of the base the proposal was computed against. */
  baseContentHash: string;
}): SkillApprovalAuthz {
  if (params.requiresAdmin) {
    // Global skills are org-wide, so an admin may always approve. We also allow
    // the skill's own owner/promoter (the resolved approverUserId) to approve
    // their own change — otherwise the update DM is routed to the owner but the
    // owner can never act on it, deadlocking the proposal.
    if (!params.callerIsAdmin && params.callerUserId !== params.approverUserId) {
      return { ok: false, code: 403, reason: "global skill changes can only be approved by the skill owner or an admin" };
    }
  } else if (params.callerUserId !== params.approverUserId && !params.callerIsAdmin) {
    return { ok: false, code: 403, reason: "only the skill owner (or an admin) can approve this change" };
  }
  if (!skillHashEquals(params.currentContentHash, params.baseContentHash)) {
    return { ok: false, code: 409, reason: "the skill changed since this update was proposed — re-run update-skill against the latest version" };
  }
  return { ok: true };
}

export type SkillFileUpdateAuthz = { ok: true } | { ok: false; code: 403; reason: string };

/**
 * Authorize a DIRECT file upload/replace on a skill — the dashboard "Edit"
 * upload that hits `PUT /:slug/files`.
 *
 * Trust model mirrors {@link authorizeSkillUpdateApproval}:
 *   • a CLAW_ADMIN may edit any skill's files;
 *   • the skill's recorded owner may edit their OWN skill's files, whether the
 *     skill is `personal` OR `global`.
 *
 * A global skill's owner can already self-approve an `update-skill` proposal
 * (see authorizeSkillUpdateApproval), so gating the equivalent direct edit on
 * `scope === "personal"` locked owners out of their own global skill for no
 * added safety. A skill with no `ownerUserId` has no owner, so only an admin
 * qualifies.
 */
export function authorizeSkillFileUpdate(params: {
  ownerUserId: string | null;
  callerUserId: string;
  callerIsAdmin: boolean;
}): SkillFileUpdateAuthz {
  if (params.callerIsAdmin) return { ok: true };
  const isOwner = !!params.ownerUserId && params.ownerUserId === params.callerUserId;
  if (!isOwner) {
    return { ok: false, code: 403, reason: "Only the skill owner or a CLAW_ADMIN can update files" };
  }
  return { ok: true };
}
