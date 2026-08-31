import { describe, expect, it } from "vitest";
import { applyChannelRules } from "./channel-rules.js";
import type { ResolvedChannel } from "./types.js";

const ch = (id: string, name: string, lastActivityAt = 0): ResolvedChannel => ({ id, name, lastActivityAt });

const memberships = [
  ch("ch_1", "eng-payments", 500),
  ch("ch_2", "eng-platform", 400),
  ch("ch_3", "ops-oncall", 300),
  ch("ch_4", "random-watercooler", 200),
  ch("ch_5", "eng-payments-archive", 100),
];

const rules = (over: Partial<Parameters<typeof applyChannelRules>[1]> = {}) => ({
  include: [],
  includePattern: [],
  exclude: [],
  excludePattern: [],
  maxChannels: 25,
  ...over,
});

describe("applyChannelRules", () => {
  it("with no include rule, watches every channel the bot is a member of", () => {
    const out = applyChannelRules(memberships, rules());
    expect(out.channels).toHaveLength(5);
    expect(out.truncated).toBe(false);
  });

  it("matches explicit ids", () => {
    const out = applyChannelRules(memberships, rules({ include: ["ch_1", "ch_3"] }));
    expect(out.channels.map((c) => c.id)).toEqual(["ch_1", "ch_3"]);
  });

  it("matches a name regex, case-insensitively", () => {
    const out = applyChannelRules(memberships, rules({ includePattern: ["^ENG-"] }));
    expect(out.channels.map((c) => c.name)).toEqual(["eng-payments", "eng-platform", "eng-payments-archive"]);
  });

  it("unions ids and patterns", () => {
    const out = applyChannelRules(memberships, rules({ include: ["ch_4"], includePattern: ["^ops-"] }));
    expect(out.channels.map((c) => c.id).sort()).toEqual(["ch_3", "ch_4"]);
  });

  it("applies exclude after include — exclusion always wins", () => {
    const out = applyChannelRules(
      memberships,
      rules({ includePattern: ["^eng-"], excludePattern: ["-archive$"] }),
    );
    expect(out.channels.map((c) => c.name)).toEqual(["eng-payments", "eng-platform"]);
  });

  it("excludes by explicit id even when a pattern matched it", () => {
    const out = applyChannelRules(memberships, rules({ includePattern: ["^eng-"], exclude: ["ch_2"] }));
    expect(out.channels.map((c) => c.id)).toEqual(["ch_1", "ch_5"]);
  });

  it("can only ever narrow to actual memberships — a catch-all cannot reach a channel the bot is not in", () => {
    const out = applyChannelRules([ch("ch_1", "only-one")], rules({ includePattern: [".*"] }));
    expect(out.channels.map((c) => c.id)).toEqual(["ch_1"]);
  });

  it("caps at maxChannels, dropping the LEAST recently active", () => {
    const out = applyChannelRules(memberships, rules({ maxChannels: 2 }));
    expect(out.truncated).toBe(true);
    expect(out.channels.map((c) => c.id)).toEqual(["ch_1", "ch_2"]);
  });

  it("returns nothing when nothing matches, rather than falling back to everything", () => {
    const out = applyChannelRules(memberships, rules({ includePattern: ["^nope-"] }));
    expect(out.channels).toEqual([]);
  });

  it("ignores an uncompilable pattern instead of throwing", () => {
    expect(() => applyChannelRules(memberships, rules({ includePattern: ["([a-z"] }))).not.toThrow();
  });

  it("handles empty memberships", () => {
    expect(applyChannelRules([], rules({ includePattern: [".*"] })).channels).toEqual([]);
  });
});
