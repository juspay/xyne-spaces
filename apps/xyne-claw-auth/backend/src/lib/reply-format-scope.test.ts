import { describe, expect, it } from "vitest";
import { scopeReplyFormat } from "./reply-format-scope.js";

const fmt = { maxSections: 5, maxWords: 100 };

describe("scopeReplyFormat", () => {
  it("keeps the format a messaging channel asked for", () => {
    expect(scopeReplyFormat({ a: 1 }, { replyFormat: fmt }, true)).toEqual({ a: 1, replyFormat: fmt });
  });

  it("never applies a format saved in the agent's stored config", () => {
    expect(scopeReplyFormat({ replyFormat: fmt, a: 1 }, undefined, true)).toEqual({ a: 1 });
    expect(scopeReplyFormat({ replyFormat: fmt }, { b: 2 }, false)).toEqual({ b: 2 });
  });

  it("drops a requested format on runs that are not from a messaging channel", () => {
    expect(scopeReplyFormat({}, { replyFormat: fmt, b: 2 }, false)).toEqual({ b: 2 });
  });

  it("lets the request override other stored keys as before", () => {
    expect(scopeReplyFormat({ a: 1, b: 1 }, { b: 2 }, false)).toEqual({ a: 1, b: 2 });
  });
});
