import { describe, expect, it } from "vitest";
import { checkVoiceToneCompliance, type VoiceToneFinding } from "./voice-tone-qa.js";
import { parseVoiceSection, type VoiceRules } from "./voice-tone.js";

/**
 * The QA check reports on COPY, and only where it is confident. Half of what
 * follows pins the things it must stay quiet about — markup, code samples,
 * proper nouns, acronyms, CSS-cased buttons — because a check that cries wolf
 * is one that gets switched off, and then it is checking nothing at all.
 */

const rules = (overrides: Partial<VoiceRules> = {}): VoiceRules => ({
  toneWords: [],
  preferredWording: [],
  bannedPhrases: [],
  casing: {},
  ...overrides,
});

const types = (findings: VoiceToneFinding[]): string[] => findings.map((finding) => finding.type);

describe("banned phrases", () => {
  const banned = rules({ bannedPhrases: ["delve", "seamlessly", "best-in-class solution"] });

  it("flags a match with its line and the text that matched", () => {
    const content = "# Overview\n\nWe seamlessly connect your tools.\n";
    const findings = checkVoiceToneCompliance(content, banned);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      type: "banned-phrase",
      line: 3,
      matchedText: "seamlessly",
    });
    expect(findings[0]?.message).toContain('Banned phrase "seamlessly"');
    // The snippet is what makes it findable in a long document.
    expect(findings[0]?.message).toContain("We seamlessly connect your tools.");
  });

  it("is case-insensitive", () => {
    expect(checkVoiceToneCompliance("Delve into DELVE and delve.", banned)).toHaveLength(3);
  });

  it("matches whole words only, so an inflection is not a hit", () => {
    // The ticket's own case: "delve" must not fire on "delved".
    expect(checkVoiceToneCompliance("We delved into it. Delver. Undelve.", banned)).toEqual([]);
    expect(checkVoiceToneCompliance("We delve into it.", banned)).toHaveLength(1);
  });

  it("matches a multi-word phrase across a line wrap in the source", () => {
    const findings = checkVoiceToneCompliance("A best-in-class    solution awaits.", banned);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.matchedText).toBe("best-in-class    solution");
  });

  it("flags every occurrence on a line", () => {
    const findings = checkVoiceToneCompliance("delve and delve again", banned);
    expect(findings).toHaveLength(2);
    expect(findings.every((finding) => finding.line === 1)).toBe(true);
  });

  it("reads copy, not markup", () => {
    // A class name and an href are not things a reader sees.
    const content = `<div class="seamlessly-grid"><a href="/delve">Learn more</a></div>`;
    expect(checkVoiceToneCompliance(content, banned)).toEqual([]);
  });

  it("ignores a fenced code block and inline code", () => {
    const content = "Intro.\n\n```js\nconst delve = 1;\n```\n\nUse `delve()` to start.\n";
    expect(checkVoiceToneCompliance(content, banned)).toEqual([]);
  });

  it("ignores the body of a stylesheet, a script and an HTML code block", () => {
    // Found by running the check over a real artifact rather than a fixture.
    // This text sits BETWEEN tags, not inside one, so stripping tags leaves it
    // behind — and HTML is what a /design run actually delivers.
    const content = [
      "<style>",
      "  .seamlessly-grid { display: grid; }",
      "</style>",
      "<script>",
      "  const delve = loadDelveWidget();",
      "</script>",
      "<pre><code>const delve = utilize();</code></pre>",
      "<p>Read the <code>delve()</code> docs.</p>",
    ].join("\n");
    expect(checkVoiceToneCompliance(content, banned)).toEqual([]);
  });

  it("still reports copy on the lines around a masked block, at the right line", () => {
    const content = [
      "<style>",
      "  .seamlessly-grid { display: grid; }",
      "</style>",
      "<p>We seamlessly connect your tools.</p>",
    ].join("\n");
    const findings = checkVoiceToneCompliance(content, banned);
    expect(findings).toHaveLength(1);
    // Masking preserves offsets, so the line number still refers to the
    // caller's own content.
    expect(findings[0]?.line).toBe(4);
  });

  it("does not check a heading or a button that only exists inside a code example", () => {
    const rulesWithCasing = rules({
      casing: { headings: "sentence-case", buttons: "sentence-case" },
    });
    const content = "<pre><code>&lt;h1&gt;Get Started Today&lt;/h1&gt;</code></pre>\n<code><button>Start Free Trial</button></code>";
    expect(checkVoiceToneCompliance(content, rulesWithCasing)).toEqual([]);
  });

  it("still flags the words inside a heading or a button, which are copy", () => {
    const findings = checkVoiceToneCompliance("## Delve deeper\n\n<button>Delve</button>", banned);
    expect(findings).toHaveLength(2);
    expect(types(findings)).toEqual(["banned-phrase", "banned-phrase"]);
  });
});

describe("preferred wording", () => {
  const preferred = rules({
    preferredWording: [
      { avoid: "utilize", prefer: "use" },
      { avoid: "client-side", prefer: "on-device" },
    ],
  });

  it("flags the avoided term and suggests the replacement", () => {
    const findings = checkVoiceToneCompliance("Utilize the client-side cache.", preferred);
    expect(findings).toHaveLength(2);
    expect(findings[0]).toMatchObject({
      type: "preferred-wording",
      matchedText: "Utilize",
      suggestion: "use",
      line: 1,
    });
    expect(findings[0]?.message).toContain('Prefer "use" over "utilize"');
    expect(findings[1]).toMatchObject({ matchedText: "client-side", suggestion: "on-device" });
  });

  it("reports a term that is both banned and non-preferred once, as banned", () => {
    const both = rules({
      bannedPhrases: ["utilize"],
      preferredWording: [{ avoid: "utilize", prefer: "use" }],
    });
    const findings = checkVoiceToneCompliance("Utilize it.", both);
    expect(types(findings)).toEqual(["banned-phrase"]);
  });

  it("leaves the preferred term itself alone", () => {
    expect(checkVoiceToneCompliance("Use the on-device cache.", preferred)).toEqual([]);
  });
});

describe("heading casing", () => {
  const sentence = rules({ casing: { headings: "sentence-case" } });
  const title = rules({ casing: { headings: "title-case" } });

  it("flags a title-cased heading under a sentence-case rule", () => {
    const findings = checkVoiceToneCompliance("## The Future of Work\n", sentence);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      type: "heading-casing",
      line: 1,
      matchedText: "The Future of Work",
    });
    expect(findings[0]?.message).toContain("looks title-cased");
    expect(findings[0]?.message).toContain('"Future"');
    // Lower-casing a word might be lower-casing a proper noun, so the fix is
    // described rather than performed.
    expect(findings[0]?.suggestion).toBeUndefined();
  });

  it("flags a short title-cased label, where one capital is all there is to go on", () => {
    expect(checkVoiceToneCompliance("### Get Started\n", sentence)).toHaveLength(1);
  });

  it("passes a sentence-cased heading", () => {
    expect(checkVoiceToneCompliance("# Start your free trial\n", sentence)).toEqual([]);
  });

  it("stays quiet on a single proper noun after a function word", () => {
    // The false positives that would get this check switched off. "Powered by
    // Stripe" is three words with one capital, exactly like "Get Started" —
    // the lower-case "by" is the whole difference.
    for (const heading of [
      "## Built with GitHub Actions",
      "## Deploy to Vercel in minutes",
      "## Powered by Stripe",
      "## Works with Slack",
    ]) {
      expect(checkVoiceToneCompliance(`${heading}\n`, sentence), heading).toEqual([]);
    }
  });

  it("flags a capitalised function word, which no sentence-caser writes", () => {
    const findings = checkVoiceToneCompliance("## Book A Demo\n", sentence);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain('"A"');
  });

  it("does not re-case an acronym or a brand's own casing", () => {
    expect(checkVoiceToneCompliance("## API keys and iPhone support\n", sentence)).toEqual([]);
    expect(checkVoiceToneCompliance("## Our CSS and HTML output\n", sentence)).toEqual([]);
  });

  it("allows a capital that opens a new sentence", () => {
    expect(checkVoiceToneCompliance("## Pricing: Simple plans for every team\n", sentence)).toEqual(
      [],
    );
  });

  it("flags a sentence-cased heading under a title-case rule, and suggests the rewrite", () => {
    const findings = checkVoiceToneCompliance("## Get started with the api\n", title);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain("is not title case");
    // Capitalising is unambiguous, so this fix is offered outright. Function
    // words stay lower-case mid-phrase; the last word is capitalised.
    expect(findings[0]?.suggestion).toBe("Get Started with the Api");
  });

  it("passes a title-cased heading under a title-case rule", () => {
    expect(checkVoiceToneCompliance("## The Future of Work\n", title)).toEqual([]);
    expect(checkVoiceToneCompliance("## Build with the Xyne API\n", title)).toEqual([]);
  });

  it("checks HTML headings as well as markdown ones", () => {
    const content = "<h1>Welcome</h1>\n<h2>Get Started Today</h2>\n";
    const findings = checkVoiceToneCompliance(content, sentence);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ line: 2, matchedText: "Get Started Today" });
  });

  it("reads through tags inside a heading", () => {
    const findings = checkVoiceToneCompliance('<h2>Get <span class="x">Started</span></h2>', sentence);
    expect(findings[0]?.matchedText).toBe("Get Started");
  });

  it("ignores a heading inside a fenced block", () => {
    expect(checkVoiceToneCompliance("```md\n## Get Started\n```\n", sentence)).toEqual([]);
  });

  it("checks nothing when no heading rule was stated", () => {
    expect(checkVoiceToneCompliance("## Get Started Today\n", rules())).toEqual([]);
  });

  it("checks nothing under preserve", () => {
    const preserve = rules({ casing: { headings: "preserve" } });
    expect(checkVoiceToneCompliance("## Get Started Today\n", preserve)).toEqual([]);
  });
});

describe("button and CTA casing", () => {
  const sentence = rules({ casing: { buttons: "sentence-case" } });
  const upper = rules({ casing: { buttons: "uppercase" } });

  it("flags a title-cased button", () => {
    const findings = checkVoiceToneCompliance("<button>Start Free Trial</button>", sentence);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      type: "button-casing",
      line: 1,
      matchedText: "Start Free Trial",
    });
  });

  it("passes a sentence-cased button", () => {
    expect(checkVoiceToneCompliance("<button>Start my trial</button>", sentence)).toEqual([]);
  });

  it("finds a button by class, by role, and as a submit input", () => {
    const content = [
      '<a class="btn btn-primary" href="/x">Start Free Trial</a>',
      '<div role="button" tabindex="0">Book A Demo</div>',
      '<input type="submit" value="Send My Details">',
    ].join("\n");
    const findings = checkVoiceToneCompliance(content, sentence);
    expect(findings.map((finding) => finding.line)).toEqual([1, 2, 3]);
    expect(findings[2]?.matchedText).toBe("Send My Details");
  });

  it("reports a button once when it matches more than one pattern", () => {
    const findings = checkVoiceToneCompliance('<button class="btn">Start Free Trial</button>', sentence);
    expect(findings).toHaveLength(1);
  });

  it("treats a standalone markdown link as a CTA", () => {
    const findings = checkVoiceToneCompliance("Intro text.\n\n[Start Free Trial](/signup)\n", sentence);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ line: 3, matchedText: "Start Free Trial" });
  });

  it("does not treat an inline link as a CTA", () => {
    const content = "Read the [Getting Started Guide](/docs) before you begin.\n";
    expect(checkVoiceToneCompliance(content, sentence)).toEqual([]);
  });

  it("flags a mixed-case button under an uppercase rule, and suggests the rewrite", () => {
    const findings = checkVoiceToneCompliance("<button>Start now</button>", upper);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain("is not upper case");
    expect(findings[0]?.suggestion).toBe("START NOW");
  });

  it("passes an upper-case button", () => {
    expect(checkVoiceToneCompliance("<button>START NOW</button>", upper)).toEqual([]);
  });

  it("takes a CSS text-transform as the uppercase rule being met", () => {
    // Upper-casing in the stylesheet is the norm. Flagging every label on a
    // compliant artifact is how this check would earn its way to being off.
    const content = [
      "<style>.btn { text-transform: uppercase; }</style>",
      '<button class="btn">Start now</button>',
    ].join("\n");
    expect(checkVoiceToneCompliance(content, upper)).toEqual([]);
  });

  it("does not let a text-transform excuse a sentence-case rule", () => {
    const content = "<style>.btn { text-transform: uppercase; }</style>\n<button>Start Free Trial</button>";
    expect(checkVoiceToneCompliance(content, sentence)).toHaveLength(1);
  });
});

describe("the whole check", () => {
  const voiceRules = parseVoiceSection(`## Voice

- **Tone:** direct, concise
- **Prefer:** "use" over "utilize"
- **Avoid:** delve, seamlessly
- **Headings:** sentence case
- **Buttons:** sentence case
`);

  it("returns nothing for content that follows the rules", () => {
    const clean = `# Ship faster with Xyne

Connect your tools and use the API in minutes.

<button>Start my trial</button>

\`\`\`js
// utilize is fine in a code sample
const delve = utilize();
\`\`\`
`;
    expect(checkVoiceToneCompliance(clean, voiceRules)).toEqual([]);
  });

  it("returns nothing when there are no rules to check", () => {
    expect(checkVoiceToneCompliance("## Get Started\n\nWe seamlessly delve.", rules())).toEqual([]);
  });

  it("returns nothing for empty content", () => {
    expect(checkVoiceToneCompliance("", voiceRules)).toEqual([]);
  });

  it("reports every kind of finding, ordered by line", () => {
    const content = `# The Future of Work

We seamlessly utilize your data.

<button>Start Free Trial</button>
`;
    const findings = checkVoiceToneCompliance(content, voiceRules);
    expect(findings.map((finding) => [finding.line, finding.type])).toEqual([
      [1, "heading-casing"],
      [3, "banned-phrase"],
      [3, "preferred-wording"],
      [5, "button-casing"],
    ]);
    // An empty array is the pass signal; there is no separate boolean to drift.
    expect(findings.length === 0).toBe(false);
  });
});
