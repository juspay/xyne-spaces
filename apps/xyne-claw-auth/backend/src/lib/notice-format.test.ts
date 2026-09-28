import { describe, expect, it } from "vitest";
import { notice, pluralize, sentenceList } from "./notice-format.js";
import { formatStopReply } from "./webhook-commands/stop.js";

describe("sentenceList", () => {
  it("joins as prose, not as delimiter-separated fragments", () => {
    expect(sentenceList(["a"])).toBe("a");
    expect(sentenceList(["a", "b"])).toBe("a and b");
    expect(sentenceList(["a", "b", "c"])).toBe("a, b, and c");
  });

  it("drops empty entries so a skipped clause leaves no dangling comma", () => {
    expect(sentenceList(["a", "", "  ", "b"])).toBe("a and b");
    expect(sentenceList([])).toBe("");
  });
});

describe("pluralize", () => {
  it("agrees with the count and leads with the number", () => {
    expect(pluralize(1, "run")).toBe("1 run");
    expect(pluralize(0, "run")).toBe("0 runs");
    expect(pluralize(2, "run")).toBe("2 runs");
    expect(pluralize(2, "queued message")).toBe("2 queued messages");
  });
});

describe("notice", () => {
  it("bolds the lead and keeps the detail as a sentence", () => {
    expect(notice("Stopped.", "Cancelled 1 run.")).toBe("**Stopped.** Cancelled 1 run.");
    expect(notice("Stopped.")).toBe("**Stopped.**");
    expect(notice("Stopped.", "   ")).toBe("**Stopped.**");
  });
});

/**
 * The /stop reply is the message from the bug report. It used to read
 *   "🛑 Stopped 1 running run - cleaned 0 stale runs - dropped 0 queued messages."
 * — three counts, two of them zero, joined by dashes.
 */
describe("formatStopReply", () => {
  const base = { stopped: 0, cleaned: 0, queued: 0, hadRunningRows: false };

  it("reports only the thing that happened", () => {
    expect(formatStopReply("askpmm", { ...base, stopped: 1, hadRunningRows: true }, false))
      .toBe("**Stopped.** Cancelled 1 run.");
  });

  it("never mentions a zero count", () => {
    const reply = formatStopReply("askpmm", { ...base, stopped: 1, hadRunningRows: true }, false);
    expect(reply).not.toContain("0 ");
    expect(reply).not.toContain("stale");
    expect(reply).not.toContain("queued");
  });

  it("carries no emoji", () => {
    const replies = [
      formatStopReply("askpmm", { ...base, stopped: 1, hadRunningRows: true }, false),
      formatStopReply("askpmm", { ...base, stopped: 2, queued: 3, cleaned: 1, hadRunningRows: true }, true),
      formatStopReply("askpmm", base, false),
    ];
    for (const reply of replies) {
      expect(reply).not.toMatch(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u);
    }
  });

  it("joins several outcomes as prose", () => {
    expect(formatStopReply("askpmm", { stopped: 2, cleaned: 1, queued: 3, hadRunningRows: true }, true))
      .toBe("**Stopped.** Cancelled 2 runs, dropped 3 queued messages, cleaned up 1 stale run, and cleared the active goal.");
  });

  it("names the agent when there was nothing to stop", () => {
    expect(formatStopReply("askpmm", base, false))
      .toBe("Nothing is running for askpmm in this thread right now.");
  });

  it("reports a dropped queue even when no run was cancelled", () => {
    expect(formatStopReply("askpmm", { ...base, queued: 2 }, false))
      .toBe("**Stopped.** Dropped 2 queued messages.");
  });

  it("reports a cleared goal on its own", () => {
    expect(formatStopReply("askpmm", base, true))
      .toBe("**Stopped.** Cleared the active goal.");
  });

  it("does not claim work it did not do when rows existed but none were cancellable", () => {
    expect(formatStopReply("askpmm", { ...base, hadRunningRows: true }, false))
      .toBe("**Stopped.** No active work remained for askpmm.");
  });

  it("agrees singular and plural", () => {
    expect(formatStopReply("a", { ...base, stopped: 1, hadRunningRows: true }, false)).toContain("1 run.");
    expect(formatStopReply("a", { ...base, stopped: 2, hadRunningRows: true }, false)).toContain("2 runs.");
  });
});
