import { describe, expect, it } from "vitest";
import { formatForTeams } from "./format.js";

describe("formatForTeams", () => {
  it("keeps what Teams renders: emphasis, code, links, lists", () => {
    const md = "**bold** _it_ ~~gone~~ `x` [docs](https://example.test)\n\n- one\n- two\n\n1. first\n2. second";
    expect(formatForTeams(md)).toBe(md);
  });

  it("turns headings into a bold line", () => {
    expect(formatForTeams("## Summary\n\nAll good")).toBe("**Summary**\n\nAll good");
  });

  it("puts a table in a code block, without the separator row", () => {
    expect(formatForTeams("| a | b |\n|---|---|\n| 1 | 2 |")).toBe("```\n| a | b |\n| 1 | 2 |\n```");
  });

  it("drops horizontal rules and renders task lists", () => {
    expect(formatForTeams("above\n\n---\n\n- [x] done\n- [ ] todo")).toBe("above\n\n- ☑ done\n- ☐ todo");
  });

  it("keeps single line breaks between prose lines as hard breaks", () => {
    expect(formatForTeams("line one\nline two")).toBe("line one  \nline two");
  });

  it("leaves fenced code untouched, including tables and headings inside it", () => {
    const md = "```ts\n# not a heading\n| a | b |\nconst x = 1;\n```";
    expect(formatForTeams(md)).toBe(md);
  });

  it("closes a fence the model left open", () => {
    expect(formatForTeams("```\ncode")).toBe("```\ncode\n```");
  });
});
