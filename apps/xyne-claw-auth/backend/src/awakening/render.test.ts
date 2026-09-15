import { describe, expect, it } from "vitest";
import { renderWindow, renderEventsJsonl, renderWindowMarkdown, assignLineNumbers, EVENTS_PATH } from "./render.js";
import { computeSignals } from "./signals.js";
import { AWAKENING_DEFAULTS } from "./config.js";
import type { AwakeningWindow, WindowEvent } from "./types.js";

function ev(over: Partial<WindowEvent> = {}): WindowEvent {
  const atMs = over.atMs ?? 1_700_000_000_000;
  return {
    L: 0,
    kind: "message",
    at: new Date(atMs).toISOString(),
    atMs,
    id: "msg_1",
    ch: "ch_1",
    chName: "eng-payments",
    cv: "cv_1",
    cvTitle: "5xx spike",
    sender: "Priya Nair",
    senderId: "u_1",
    isHuman: true,
    isMe: false,
    root: false,
    mentionsMe: false,
    unanswered: false,
    covered: false,
    coveredBy: null,
    question: false,
    actionSignals: [],
    edited: false,
    chars: 5,
    text: "hello",
    ...over,
  };
}

function win(events: WindowEvent[], over: Partial<AwakeningWindow> = {}): AwakeningWindow {
  return {
    agentId: "ag_1",
    agentSlug: "ops-sentinel",
    orgId: "org_1",
    kind: "heartbeat",
    startMs: 1_700_000_000_000,
    endMs: 1_700_000_600_000,
    channels: [{ id: "ch_1", name: "eng-payments", lastActivityAt: 0 }],
    silentChannels: [{ id: "ch_2", name: "ops-quiet", lastActivityAt: 0 }],
    events,
    signals: computeSignals(events),
    truncated: false,
    gap: null,
    priorRuns: [],
    config: AWAKENING_DEFAULTS,
    ...over,
  };
}

/**
 * events.jsonl grep-ability is a FORMAT CONTRACT. WINDOW.md and the heartbeat
 * skill both print recipes like `grep '"unanswered":true'`; a key rename or a
 * quoted boolean silently breaks every one of them.
 */
describe("renderEventsJsonl — the grep contract", () => {
  it("emits unquoted booleans that the advertised recipes match exactly", () => {
    const line = renderEventsJsonl([ev({ unanswered: true, mentionsMe: true, isMe: false, question: true })]);
    expect(line).toContain('"unanswered":true');
    expect(line).toContain('"mentionsMe":true');
    expect(line).toContain('"isMe":false');
    expect(line).toContain('"question":true');
  });

  it("keeps a stable key order with text last", () => {
    const keys = Object.keys(JSON.parse(renderEventsJsonl([ev()])));
    expect(keys[0]).toBe("L");
    expect(keys.at(-1)).toBe("text");
    expect(keys).toEqual([
      "L", "kind", "at", "id", "ch", "chName", "cv", "cvTitle", "sender", "senderId",
      "isHuman", "isMe", "root", "mentionsMe", "unanswered", "covered", "coveredBy",
      "question", "actionSignals", "edited", "chars", "text",
    ]);
  });

  it("assigns 1-based sequential line numbers", () => {
    const events = assignLineNumbers([ev({ id: "a" }), ev({ id: "b" }), ev({ id: "c" })]);
    const lines = renderEventsJsonl(events).split("\n");
    expect(lines).toHaveLength(3);
    expect(events.map((e) => e.L)).toEqual([1, 2, 3]);
    expect(JSON.parse(lines[0]!).L).toBe(1);
  });

  it("writes one line per event with no pretty-printing", () => {
    const out = renderEventsJsonl([ev({ text: "line one\nline two" }), ev()]);
    expect(out.split("\n")).toHaveLength(2);
  });

  it("renders an empty window as an empty string", () => {
    expect(renderEventsJsonl([])).toBe("");
  });

  it("matches the escalation recipe printed in WINDOW.md", () => {
    const line = renderEventsJsonl([ev({ actionSignals: ["escalation", "urgent"] })]);
    expect(line).toContain('"actionSignals":["escalation');
  });
});

describe("renderWindow", () => {
  it("produces the three artifact files and points at WINDOW.md", () => {
    const out = renderWindow(win([ev()]));
    expect(out.files.map((f) => f.path)).toEqual([
      "heartbeat/events.jsonl",
      "heartbeat/WINDOW.md",
      "heartbeat/CURSOR.json",
    ]);
    expect(out.entryPath).toBe(".context/heartbeat/WINDOW.md");
  });

  it("keeps outline anchors and jsonl line numbers in agreement", () => {
    const events = [ev({ id: "a" }), ev({ id: "b", atMs: 1_700_000_100_000 })];
    const out = renderWindow(win(events));
    const md = out.files.find((f) => f.path.endsWith("WINDOW.md"))!.content;
    // The outline cites L1–L2; the jsonl must actually have those line numbers.
    expect(md).toContain("L1–L2");
    expect(out.files[0]!.content.split("\n")).toHaveLength(2);
  });

  it("emits valid JSON in CURSOR.json", () => {
    const out = renderWindow(win([ev()]));
    const cursor = JSON.parse(out.files.find((f) => f.path.endsWith("CURSOR.json"))!.content);
    expect(cursor.agentSlug).toBe("ops-sentinel");
    expect(cursor.signals.eventCount).toBe(1);
  });
});

describe("renderWindowMarkdown", () => {
  it("surfaces truncation loudly — a silent cut reads as a quiet window", () => {
    const md = renderWindowMarkdown(win([ev()], { truncated: true }));
    expect(md).toContain("truncated: true");
    expect(md).toMatch(/This window was truncated/);
  });

  it("surfaces a gap so the agent knows it missed events", () => {
    const md = renderWindowMarkdown(win([ev()], { gap: { skippedMs: 7_200_000 } }));
    expect(md).toContain("120m skipped");
    expect(md).toMatch(/\*\*Gap:\*\* 120 minutes/);
  });

  it("states the write policy and shadow flag the run is bound by", () => {
    const md = renderWindowMarkdown(
      win([ev()], { config: { ...AWAKENING_DEFAULTS, writePolicy: "observe", shadow: true } }),
    );
    expect(md).toContain("writePolicy: observe");
    expect(md).toContain("shadow: true");
  });

  it("lists watched-but-silent channels as useful negative space", () => {
    expect(renderWindowMarkdown(win([ev()]))).toContain("ops-quiet");
  });

  it("tags mentions, unanswered and action signals in the outline", () => {
    const md = renderWindowMarkdown(
      win([ev({ mentionsMe: true, unanswered: true, actionSignals: ["urgent"] })]),
    );
    expect(md).toContain("MENTION");
    expect(md).toContain("UNANSWERED");
    expect(md).toContain("urgent");
  });

  it("marks the agent's own messages so it never answers itself", () => {
    expect(renderWindowMarkdown(win([ev({ isMe: true, isHuman: false })]))).toContain("[you]");
  });

  it("tells the agent it has no bash", () => {
    expect(renderWindowMarkdown(win([ev()]))).toMatch(/do \*\*not\*\* have bash/);
  });

  it("advertises grep recipes against the real events path", () => {
    const md = renderWindowMarkdown(win([ev()]));
    expect(md).toContain(`.context/${EVENTS_PATH}`);
    expect(md).toContain(`grep '"unanswered":true'`);
  });

  it("renders an empty window without throwing", () => {
    expect(() => renderWindowMarkdown(win([]))).not.toThrow();
  });
});

describe("thread line anchors", () => {
  const at = (n: number) => 1_700_000_000_000 + n * 1000;

  it("writes a contiguous range as L<from>–L<to>", () => {
    const md = renderWindowMarkdown(
      win([ev({ id: "a", cv: "cv_1", atMs: at(1) }), ev({ id: "b", cv: "cv_1", atMs: at(2) })]),
    );
    expect(md).toContain("(2 events, L1–L2)");
  });

  it("writes a single-event thread as one line, not a range", () => {
    expect(renderWindowMarkdown(win([ev({ id: "a", cv: "cv_1" })]))).toContain("(1 event, L1)");
  });

  it("lists exact lines when a thread is interleaved with others", () => {
    // cv_1 lands on lines 1 and 3; rendering that as L1–L3 would invite a read
    // that is one-third someone else's thread.
    const md = renderWindowMarkdown(
      win([
        ev({ id: "a", cv: "cv_1", cvTitle: "first", atMs: at(1) }),
        ev({ id: "b", cv: "cv_2", cvTitle: "second", atMs: at(2) }),
        ev({ id: "c", cv: "cv_1", cvTitle: "first", atMs: at(3) }),
      ]),
    );
    expect(md).toContain("(2 events, lines L1, L3)");
    expect(md).not.toContain("L1–L3");
  });

  it("falls back to a grep hint for a badly fragmented thread", () => {
    const events = Array.from({ length: 20 }, (_, i) =>
      ev({ id: `m${i}`, cv: i % 2 === 0 ? "cv_even" : "cv_odd", atMs: at(i) }),
    );
    const md = renderWindowMarkdown(win(events));
    expect(md).toMatch(/10 lines between L1 and L19 — grep '"cv":"cv_even"'/);
  });
});

describe("requirement 7 — prior runs in this window", () => {
  const prior = (over: Partial<import("./prior-runs.js").PriorRun> = {}) => ({
    kind: "reflex",
    windowStartMs: 1_700_000_000_000,
    windowEndMs: 1_700_000_300_000,
    outcome: "ran",
    eventCount: 5,
    sessionId: "s1",
    startedAt: new Date(1_700_000_010_000),
    completedAt: new Date(1_700_000_290_000),
    result: "Replied in cv_1 acking the spike.",
    status: "completed",
    covers: true,
    ...over,
  });

  it("omits the section entirely when nothing ran before", () => {
    const md = renderWindowMarkdown(win([ev()]));
    expect(md).not.toContain("What already happened");
    expect(md).toContain("## 4. Outline");
  });

  it("summarises prior runs and points at the detail file", () => {
    const md = renderWindowMarkdown(win([ev()], { priorRuns: [prior()] }));
    expect(md).toContain("## 3. What already happened in this window");
    expect(md).toContain("1 earlier awakened run(s) overlap this window; 1 of them acted");
    expect(md).toContain(".context/heartbeat/prior-sessions.md");
  });

  it("warns about an in-flight run so the heartbeat does not race it", () => {
    const md = renderWindowMarkdown(win([ev()], { priorRuns: [prior({ completedAt: null })] }));
    expect(md).toContain("STILL IN FLIGHT");
  });

  it("counts what is NOT already handled and gives the grep for it", () => {
    const events = [ev({ id: "a", covered: true }), ev({ id: "b" }), ev({ id: "c" })];
    const md = renderWindowMarkdown(win(events, { priorRuns: [prior()] }));
    expect(md).toContain("2 of 3 events are NOT already handled");
    expect(md).toContain(`grep '"covered":false'`);
  });

  it("tags a handled event in the outline", () => {
    const md = renderWindowMarkdown(win([ev({ covered: true, coveredBy: "reflex@09:02:40" })], { priorRuns: [prior()] }));
    expect(md).toContain("handled by reflex@09:02:40");
  });

  it("emits prior-sessions.md only when there are prior runs", () => {
    expect(renderWindow(win([ev()])).files.map((f) => f.path)).not.toContain("heartbeat/prior-sessions.md");
    expect(renderWindow(win([ev()], { priorRuns: [prior()] })).files.map((f) => f.path)).toContain(
      "heartbeat/prior-sessions.md",
    );
  });

  it("keeps coverage greppable in events.jsonl", () => {
    const line = renderEventsJsonl([ev({ covered: true, coveredBy: "reflex@09:02:40" })]);
    expect(line).toContain('"covered":true');
    expect(line).toContain('"coveredBy":"reflex@09:02:40"');
  });
});

describe("reply targets — ids as tool arguments, not just data", () => {
  it("prints the exact channelId/conversationId needed to reply to each thread", () => {
    const md = renderWindowMarkdown(
      win([ev({ ch: "ch_7Ka2", cv: "cv_9x1qP" })], {
        config: { ...AWAKENING_DEFAULTS, shadow: false, writePolicy: "reply" },
      }),
    );
    expect(md).toContain('reply here → `channelId: "ch_7Ka2", conversationId: "cv_9x1qP"`');
  });

  it("tells the agent its final answer is not delivered", () => {
    const md = renderWindowMarkdown(
      win([ev()], { config: { ...AWAKENING_DEFAULTS, shadow: false, writePolicy: "act" } }),
    );
    expect(md).toMatch(/call the Spaces send-message tool/);
    expect(md).toMatch(/posts nothing/);
  });

  it("omits the send-message instruction when the run cannot write", () => {
    const shadow = renderWindowMarkdown(win([ev()], { config: { ...AWAKENING_DEFAULTS, shadow: true } }));
    expect(shadow).not.toMatch(/call the Spaces send-message tool/);
    const observe = renderWindowMarkdown(
      win([ev()], { config: { ...AWAKENING_DEFAULTS, shadow: false, writePolicy: "observe" } }),
    );
    expect(observe).not.toMatch(/call the Spaces send-message tool/);
  });

  it("still shows reply targets per thread even in shadow, so the agent can name where it would post", () => {
    const md = renderWindowMarkdown(win([ev({ ch: "ch_1", cv: "cv_1" })]));
    expect(md).toContain('reply here → `channelId: "ch_1", conversationId: "cv_1"`');
  });
});
