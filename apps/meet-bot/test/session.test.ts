import { describe, expect, it } from "vitest";
import type { MeetState } from "../src/meetPage.js";
import { endReasonFor } from "../src/session.js";

const inCall: MeetState = {
  inCall: true,
  nameInput: false,
  blocked: false,
  denied: false,
  notAdmitted: false,
  removed: false,
  ended: false,
  notFound: false,
  participants: 3,
  aloneMessage: false,
  speaker: null,
  remoteAudioTracks: 3,
  livekitDisconnected: false,
};
const limits = { aloneTimeoutMs: 120_000, maxMeetingMs: 4 * 3_600_000 };
const tracker = () => ({ outOfCallPolls: 0, aloneSince: null as number | null, startedAt: 0 });

describe("endReasonFor", () => {
  it("keeps going during a normal meeting", () => {
    expect(endReasonFor(inCall, tracker(), 60_000, limits)).toBeNull();
  });

  it("leaves when removed or the meeting ends", () => {
    expect(endReasonFor({ ...inCall, inCall: false, removed: true }, tracker(), 1, limits)).toBe("removed");
    expect(endReasonFor({ ...inCall, inCall: false, ended: true }, tracker(), 1, limits)).toBe("meeting_ended");
  });

  it("needs several polls without the call UI before calling it left", () => {
    const t = tracker();
    const out = { ...inCall, inCall: false };
    for (let i = 0; i < 4; i++) expect(endReasonFor(out, t, i, limits)).toBeNull();
    expect(endReasonFor(out, t, 5, limits)).toBe("left_call");
  });

  it("leaves after being alone for the timeout, and resets when someone returns", () => {
    const t = tracker();
    const alone = { ...inCall, participants: 1 };
    expect(endReasonFor(alone, t, 1_000, limits)).toBeNull();
    expect(endReasonFor(inCall, t, 60_000, limits)).toBeNull();
    expect(endReasonFor(alone, t, 70_000, limits)).toBeNull();
    expect(endReasonFor(alone, t, 190_000, limits)).toBe("alone");
  });

  it("treats Meet's empty-meeting message as alone even when tiles can't be counted", () => {
    const t = tracker();
    const alone = { ...inCall, participants: 0, aloneMessage: true };
    expect(endReasonFor(alone, t, 1_000, limits)).toBeNull();
    expect(endReasonFor(alone, t, 1_000 + limits.aloneTimeoutMs, limits)).toBe("alone");
  });

  it("doesn't treat an unknown participant count as alone", () => {
    expect(endReasonFor({ ...inCall, participants: 0 }, tracker(), 10 * 60_000, limits)).toBeNull();
  });

  it("stops when LiveKit drops or the meeting runs too long", () => {
    expect(endReasonFor({ ...inCall, livekitDisconnected: true }, tracker(), 1, limits)).toBe("livekit_disconnected");
    expect(endReasonFor(inCall, tracker(), limits.maxMeetingMs, limits)).toBe("max_duration");
  });
});
