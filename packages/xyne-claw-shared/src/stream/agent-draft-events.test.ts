import { describe, expect, it } from "vitest";
import { SseParser } from "./events.js";
import { frameDraftEvent, type AgentDraftEvent } from "./agent-draft-events.js";

describe("agent draft events", () => {
  it("round-trips events through the SSE framing", () => {
    const events: AgentDraftEvent[] = [
      { event: "started", draftId: "d1", seq: 1, turnId: "t1" },
      { event: "identity", name: "Morning Brief", handle: "morning-brief", seq: 2, turnId: "t1" },
      { event: "instructions.delta", text: "You are…\n## Workflow", seq: 3, turnId: "t1" },
      { event: "done", status: "completed", timings: { totalMs: 5100, firstFieldMs: 1200 }, seq: 4, turnId: "t1" },
    ];
    const wire = events.map(frameDraftEvent).join("");
    const parsed = new SseParser<AgentDraftEvent>().feed(wire);
    expect(parsed).toEqual(events);
  });

  it("reassembles a frame split across chunks and skips keepalives", () => {
    const frame = frameDraftEvent({
      event: "reply.delta",
      text: "Which job should it do?",
      seq: 1,
      turnId: "t2",
    });
    const parser = new SseParser<AgentDraftEvent>();
    const mid = Math.floor(frame.length / 2);
    expect(parser.feed(": keepalive\n\n" + frame.slice(0, mid))).toEqual([]);
    const out = parser.feed(frame.slice(mid));
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ event: "reply.delta", text: "Which job should it do?" });
  });

  it("carries a schedule event's cron and timezone", () => {
    const parsed = new SseParser<AgentDraftEvent>().feed(
      frameDraftEvent({
        event: "schedule",
        op: "set",
        kind: "repeat",
        cron: "0 9 * * 1-5",
        timezone: "Asia/Kolkata",
        label: "Weekdays at 9:00 AM",
        task: "Send my brief",
        seq: 5,
        turnId: "t3",
      }),
    );
    expect(parsed[0]).toMatchObject({ event: "schedule", op: "set", cron: "0 9 * * 1-5" });
  });
});
