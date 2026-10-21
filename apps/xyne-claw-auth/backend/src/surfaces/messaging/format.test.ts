import { describe, expect, it } from "vitest";
import { chunkText, stripCitationMarkup } from "./format.js";
import { formatForWhatsApp } from "../whatsapp-shared/format.js";

describe("chunkText", () => {
  it("leaves a short reply as one piece", () => {
    expect(chunkText("short answer", 4000)).toEqual(["short answer"]);
  });

  it("returns nothing for an empty reply", () => {
    expect(chunkText("   ", 4000)).toEqual([]);
  });

  it("splits on paragraph breaks and keeps every chunk within the limit", () => {
    const body = Array.from({ length: 20 }, (_, i) => `Paragraph ${i} ${"x".repeat(40)}`).join("\n\n");
    const chunks = chunkText(body, 200);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) expect(chunk.length).toBeLessThanOrEqual(200);
    expect(chunks.join(" ")).toContain("Paragraph 19");
  });

  it("closes and reopens a code fence that straddles a cut", () => {
    const body = "```\n" + Array.from({ length: 30 }, (_, i) => `line ${i}`).join("\n") + "\n```";
    const chunks = chunkText(body, 100);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      const fences = (chunk.match(/```/g) ?? []).length;
      expect(fences % 2).toBe(0);
    }
  });
});

describe("formatForWhatsApp", () => {
  it("rewrites markdown emphasis into WhatsApp's dialect", () => {
    expect(formatForWhatsApp("**bold** and *italic*")).toBe("*bold* and _italic_");
  });

  it("turns headings into bold and bullets into •", () => {
    expect(formatForWhatsApp("## Summary\n- one\n- two")).toBe("*Summary*\n• one\n• two");
  });

  it("keeps a link readable, since WhatsApp has no link syntax", () => {
    expect(formatForWhatsApp("[docs](https://example.com)")).toBe("docs (https://example.com)");
  });

  it("converts every form the surface instructions promise the model", () => {
    // If this drifts, the agent is being told to write a syntax that arrives
    // as something else — which is how *bold* once reached phones as italics.
    expect(formatForWhatsApp("**bold**")).toBe("*bold*");
    expect(formatForWhatsApp("_italic_")).toBe("_italic_");
    expect(formatForWhatsApp("~~strike~~")).toBe("~strike~");
    expect(formatForWhatsApp("`code`")).toBe("`code`");
    expect(formatForWhatsApp("- one")).toBe("• one");
  });

  it("leaves the inside of a code fence alone", () => {
    expect(formatForWhatsApp("```\n**not bold**\n```")).toBe("```\n**not bold**\n```");
  });
});

describe("stripCitationMarkup", () => {
  it("removes inline clf tokens without leaving gaps before punctuation", () => {
    expect(stripCitationMarkup("Your PR is failing CI [clf-toolu_01ABCdef#3]. Fix it [clf-toolu_01ABCdef#4] [clf-toolu_01ABCdef#5].")).toBe(
      "Your PR is failing CI. Fix it.",
    );
  });

  it("removes the off-format shapes and legacy cite links too", () => {
    expect(stripCitationMarkup("[clf-abc#1] Leading, (clf-abc#2) paren, bare clf-call_9|fc_2#7 and [1.0](cite:clf-x#1) link.")).toBe(
      "Leading, paren, bare and link.",
    );
  });

  it("turns the <citation> block into a short deduped sources list", () => {
    const text = "Answer\n\n<citation>\n1. Leave is 12 days ||| [Leave policy](https://s/x)\n2. Again ||| [Leave policy](https://s/x)\n3. [Doc two](https://s/y)\n</citation>";
    expect(stripCitationMarkup(text)).toBe("Answer\n\n**Sources**\n- Leave policy: https://s/x\n- Doc two: https://s/y");
  });

  it("leaves code and ordinary brackets alone", () => {
    expect(stripCitationMarkup("```\nconst t = \"[clf-x#1]\";\n```\nafter [clf-x#2]")).toBe("```\nconst t = \"[clf-x#1]\";\n```\nafter");
    expect(stripCitationMarkup("see notes [1] or mail clf@x.com")).toBe("see notes [1] or mail clf@x.com");
  });
});
