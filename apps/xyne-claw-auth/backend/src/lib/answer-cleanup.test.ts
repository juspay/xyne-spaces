import { describe, expect, it } from "vitest";
import {
  cleanSpacesAnswer,
  friendlyRunError,
  renderChartBlocks,
  stripUnrenderedCitationTokens,
  stripWorkingNote,
} from "./answer-cleanup.js";

const REAL_NOTE_PR =
  "The research agent needs a repository bound to it before it can pull GitHub PRs. Let me try a couple of alternate routes in parallel:\n\n" +
  "Can't pull PR #900 right now — my route into GitHub (the research agent that reads repos like xyne-spaces) has no repository selected in this setup, and web search is disabled here, so I have no way to see that PR's contents.\n\n" +
  "Two ways to fix it:\n\n1. **Select `juspay/xyne-spaces` as the research repository** in my agent context";

const REAL_NOTE_DRAFT =
  "`web-search` is available and is exactly what a Marvel encyclopedia agent needs. Let me draft the agent with it.\n\n" +
  "I've drafted the **Marvel Superhero Guide** agent for you — an approval card is on its way with the details. Once you approve, it becomes a personal agent you can chat with directly to ask about any Marvel hero.";

const REAL_CITATION =
  'Your message "approve and continue test" is live in #test — posted as you [clf-call_ec32bbbce194471f88331f86#1]. Nothing else needed on this one. Want me to do anything else in that channel?';

const REAL_CHART =
  "**adfs / afd / test** — placeholder/test entries\n\n" +
  "```chart\n" +
  '{"title":"30 agents by scope","visualType":"DONUT_CHART","data":[{"label":"Personal agents","value":17},{"label":"Global (workspace-wide) agents","value":13}]}\n' +
  "```\n\n" +
  "Everything is currently enabled. Want me to open up the full config for any of these?";

describe("stripWorkingNote", () => {
  it("drops a working note left on the first line of real answers", () => {
    expect(stripWorkingNote(REAL_NOTE_PR)).toMatch(/^Can't pull PR #900 right now/);
    expect(stripWorkingNote(REAL_NOTE_DRAFT)).toMatch(/^I've drafted the \*\*Marvel Superhero Guide\*\*/);
  });

  it("leaves real first lines alone", () => {
    const keep = [
      "Here's what I found:\n\n- one\n- two",
      "Done. Let me know if you want more.\n\nThe report is attached.",
      "## Let me check the results\n\nAll green.",
      "You have **30 active agents** in this workspace. Here's the roster:\n\n1. Ask AI",
      "Let me check that for you.",
      "Let me check the logs.\n\nok",
    ];
    for (const text of keep) expect(stripWorkingNote(text)).toBe(text);
  });
});

describe("stripUnrenderedCitationTokens", () => {
  it("removes a citation token Spaces cannot turn into a chip", () => {
    expect(stripUnrenderedCitationTokens(REAL_CITATION, new Set())).toBe(
      'Your message "approve and continue test" is live in #test — posted as you. Nothing else needed on this one. Want me to do anything else in that channel?',
    );
  });

  it("keeps tokens whose citations are attached to the message", () => {
    const text = "Revenue grew 12% [clf-call_a#1] while costs fell [clf-call_b#2].";
    expect(stripUnrenderedCitationTokens(text, new Set(["call_a"]))).toBe("Revenue grew 12% [clf-call_a#1] while costs fell.");
  });
});

describe("renderChartBlocks", () => {
  it("turns a real chart block into a readable table", () => {
    expect(renderChartBlocks(REAL_CHART)).toBe(
      "**adfs / afd / test** — placeholder/test entries\n\n" +
        "**30 agents by scope**\n\n| Item | Value |\n|---|---|\n| Personal agents | 17 |\n| Global (workspace-wide) agents | 13 |\n\n" +
        "Everything is currently enabled. Want me to open up the full config for any of these?",
    );
  });

  it("renders multi-column rows and drops blocks it cannot read", () => {
    const multi = '```chart\n{"data":[{"day":"Mon","runs":3,"failed":1},{"day":"Tue","runs":5,"failed":0}]}\n```';
    expect(renderChartBlocks(multi)).toBe("| day | runs | failed |\n|---|---|---|\n| Mon | 3 | 1 |\n| Tue | 5 | 0 |");
    expect(renderChartBlocks("Before\n\n```chart\n{not json\n```\n\nAfter")).toBe("Before\n\nAfter");
  });
});

describe("cleanSpacesAnswer", () => {
  it("applies every fix and never empties an answer", () => {
    expect(cleanSpacesAnswer(`${REAL_NOTE_DRAFT} [clf-x#1]`)).toMatch(/^I've drafted[\s\S]*Marvel hero\.$/);
    expect(cleanSpacesAnswer("```chart\n{bad\n```")).toBe("```chart\n{bad\n```");
  });

  it("skips the note step when the caller already stripped it", () => {
    const twoNotes = "Let me check the second source too.\n\nResult: all good here.";
    expect(cleanSpacesAnswer(twoNotes, { workingNoteStripped: true })).toBe(twoNotes);
  });
});

describe("friendlyRunError", () => {
  it("maps raw provider failures to a short readable message", () => {
    expect(
      friendlyRunError('401 {"type":"error","error":{"type":"authentication_error","message":"invalid x-api-key"},"request_id":"req_011"}'),
    ).toBe("The AI provider rejected this agent's credentials. Check the provider key in the agent's settings.");
    expect(friendlyRunError('429 {"error":{"message":"You exceeded your current quota","type":"insufficient_quota"}}')).toBe(
      "The AI provider is rate-limited or out of quota right now. Please try again shortly.",
    );
    expect(friendlyRunError('400 {"error":{"message":"This model\'s maximum context length is 128000 tokens"}}')).toBe(
      "The conversation is too long for this model. Start a new thread or shorten the request.",
    );
    expect(friendlyRunError("503 Service Unavailable: upstream overloaded")).toBe(
      "The AI provider had a temporary problem. Please try again in a moment.",
    );
  });

  it("keeps a short plain reason and hides anything structured", () => {
    expect(friendlyRunError("Agent has no tools enabled")).toBe("Agent has no tools enabled");
    expect(friendlyRunError('{"weird":"shape"}')).toBe("Something went wrong while running the agent.");
    expect(friendlyRunError("TypeError: x is undefined\n    at run (worker.js:10:3)")).toBe(
      "Something went wrong while running the agent.",
    );
    expect(friendlyRunError(null)).toBe("Something went wrong while running the agent.");
  });
});
