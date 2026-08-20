/**
 * Locks the invocation-shape guards.
 *
 * Each assertion here corresponds to a defect that reached production or would
 * abort a query outright, and every one of them is invisible in a passing
 * typecheck — the fragments are strings, so only a test can hold their meaning
 * still. `tool-metrics-sql.ts` imports no database client precisely so this
 * file can run without one.
 */

import { describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";
import {
  CLF_CAPTURE_RE,
  CLF_TOKEN_RE,
  ERROR_CLASS,
  INVOCATIONS_IS_ARRAY,
  NOT_DROPPED_END,
  RESULT_TEXT,
  invocationsCte,
  windowPredicate,
  type AnalyticsWindow,
} from "./tool-metrics-sql.js";

const sqlText = (fragment: Prisma.Sql): string => fragment.text;

/** The exact sentinel `agentRunRepository.finalize` writes over a lost end-event. */
const SENTINEL_RESULT = "(no result — tool end event was not received)";

const baseWindow: AnalyticsWindow = {
  windowStart: new Date("2026-08-01T00:00:00.000Z"),
  windowEnd: new Date("2026-08-08T00:00:00.000Z"),
  windowColumn: "completedAt",
  userFilter: Prisma.empty,
  orgFilter: Prisma.empty,
};

describe("NOT_DROPPED_END", () => {
  it("excludes BOTH dropped-end shapes, not just the running placeholder", () => {
    const text = sqlText(NOT_DROPPED_END);
    expect(text).toContain("<> 'running'");
    expect(text).toContain("NOT LIKE '(no result%tool end event was not received)'");
  });

  it("uses a wildcard rather than the em-dash literal, which is encoding-fragile", () => {
    expect(SENTINEL_RESULT).toContain("—");
    expect(sqlText(NOT_DROPPED_END)).not.toContain("—");
    expect(SENTINEL_RESULT.startsWith("(no result")).toBe(true);
    expect(SENTINEL_RESULT.endsWith("tool end event was not received)")).toBe(true);
  });

  it("never keys on durationMs, which a genuinely instant tool also reports as 0", () => {
    expect(sqlText(NOT_DROPPED_END)).not.toContain("durationMs");
  });
});

describe("INVOCATIONS_IS_ARRAY", () => {
  it("checks jsonb_typeof before unnesting, since a non-array aborts the statement", () => {
    expect(sqlText(INVOCATIONS_IS_ARRAY)).toContain("jsonb_typeof");
    expect(sqlText(INVOCATIONS_IS_ARRAY)).toContain("'array'");
  });
});

describe("result handling", () => {
  it("reads result as text and never casts it to jsonb", () => {
    expect(sqlText(RESULT_TEXT)).toBe("COALESCE(v->>'result', '')");
    expect(sqlText(RESULT_TEXT)).not.toContain("::jsonb");
  });

});

describe("ERROR_CLASS", () => {
  it("uses a POSIX class for whitespace, since a cooked template collapses \\s to a bare s", () => {
    const text = sqlText(ERROR_CLASS);
    expect(text).toContain("[[:space:]]+");
    expect(text).not.toContain("'s+'");
  });

  it("carries no backslash escape that a tagged template would silently eat", () => {
    expect(sqlText(ERROR_CLASS)).not.toContain("\\");
  });

  it("still collapses hex ids and digit runs so one failure mode groups together", () => {
    expect(sqlText(ERROR_CLASS)).toContain("[0-9a-f]{8,}|[0-9]+");
  });
});

describe("citation token patterns", () => {
  const answer = "Revenue rose [clf-call_abc123#2] and churn fell [clf-call_xyz789#11].";

  it("detects tokens the way the runtime does", () => {
    expect(new RegExp(CLF_TOKEN_RE).test(answer)).toBe(true);
    expect(new RegExp(CLF_TOKEN_RE).test("no citations here")).toBe(false);
  });

  it("captures every distinct toolCallId, not just the first", () => {
    const ids = [...answer.matchAll(new RegExp(CLF_CAPTURE_RE, "g"))].map((m) => m[1]);
    expect(ids).toEqual(["call_abc123", "call_xyz789"]);
  });

  it("does not match a malformed token missing its chunk index", () => {
    expect(new RegExp(CLF_TOKEN_RE).test("[clf-call_abc123]")).toBe(false);
  });
});

describe("windowPredicate", () => {
  it("binds window bounds as parameters rather than inlining them", () => {
    const { text, values } = windowPredicate(baseWindow);
    expect(text).toContain('r."completedAt" >= $1');
    expect(values).toContain(baseWindow.windowStart);
    expect(values).toContain(baseWindow.windowEnd);
  });

  it("switches column so an existing index can serve the scan", () => {
    expect(sqlText(windowPredicate({ ...baseWindow, windowColumn: "startedAt" }))).toContain('r."startedAt"');
    expect(sqlText(windowPredicate(baseWindow))).toContain('r."completedAt"');
  });

  it("adds the agent filter only when scoped, and binds it", () => {
    const scoped = windowPredicate({ ...baseWindow, windowColumn: "startedAt", agentSlugs: ["euler"] });
    expect(scoped.text).toContain('r."agentSlug" =');
    expect(scoped.values).toContain("euler");
    expect(sqlText(windowPredicate(baseWindow))).not.toContain('r."agentSlug"');
    expect(sqlText(windowPredicate({ ...baseWindow, agentSlugs: [] }))).not.toContain('r."agentSlug"');
  });

  // A single slug must keep emitting equality, not a one-element IN — the
  // existing single-agent plan depends on it.
  it("emits equality for one agent and IN for several, always bound", () => {
    const one = windowPredicate({ ...baseWindow, windowColumn: "startedAt", agentSlugs: ["euler"] });
    expect(one.text).toContain('r."agentSlug" =');
    expect(one.text).not.toContain("IN (");

    const many = windowPredicate({ ...baseWindow, windowColumn: "startedAt", agentSlugs: ["euler", "gauss", "riemann"] });
    expect(many.text).toContain('r."agentSlug" IN (');
    expect(many.values).toEqual(expect.arrayContaining(["euler", "gauss", "riemann"]));
    // Bound as parameters, never interpolated — a slug is user-supplied text.
    expect(many.text).not.toContain("euler");
  });

  it("carries the caller's scope filters through verbatim", () => {
    const scoped = windowPredicate({
      ...baseWindow,
      userFilter: Prisma.sql`AND "userId" = ${"u1"}`,
      orgFilter: Prisma.sql`AND "orgId" = ${"o1"}`,
    });
    expect(scoped.values).toEqual(expect.arrayContaining(["u1", "o1"]));
  });
});

describe("invocationsCte", () => {
  it("materialises the unnest so the TOAST detoast is paid once", () => {
    expect(sqlText(invocationsCte(baseWindow))).toContain("AS MATERIALIZED");
  });

  it("exposes ordinality so call order survives as a temporal index", () => {
    expect(sqlText(invocationsCte(baseWindow))).toContain("WITH ORDINALITY");
  });

  it("guards the unnest with the array check", () => {
    expect(sqlText(invocationsCte(baseWindow))).toContain("jsonb_typeof");
  });
});
