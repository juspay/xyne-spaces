import { describe, expect, it } from "vitest";
import { generateSceneHtml } from "./scene-html.js";
import {
  MAX_NARRATION_WORDS,
  validateStoryboard,
} from "./storyboard.js";

describe("validateStoryboard", () => {
  it("accepts every supported scene kind and maps default voice to configuration", () => {
    const storyboard = validateStoryboard({
      title: "A safe <title>",
      voice: "default",
      scenes: [
        { kind: "title", narration: "Here is the story." },
        { kind: "diagram", mermaid: "graph LR; A-->B", narration: "The structure." },
        {
          kind: "code",
          file: "/workspace/src/api.ts",
          highlight: [2, 4],
          narration: "The code.",
        },
        { kind: "diff", before: "old", after: "new", narration: "The change." },
        { kind: "bullets", items: ["Faster", "Safer"], narration: "The impact." },
      ],
    });

    expect(storyboard.voice).toBeUndefined();
    expect(storyboard.scenes.map((scene) => scene.kind)).toEqual([
      "title",
      "diagram",
      "code",
      "diff",
      "bullets",
    ]);
  });

  it("rejects too many scenes, invalid highlights, and oversized narration", () => {
    expect(() =>
      validateStoryboard({
        title: "Too many",
        scenes: Array.from({ length: 13 }, () => ({ kind: "title", narration: "hello" })),
      }),
    ).toThrow(/between 1 and 12/);

    expect(() =>
      validateStoryboard({
        title: "Bad highlight",
        scenes: [
          { kind: "code", file: "api.ts", highlight: [9, 2], narration: "hello" },
        ],
      }),
    ).toThrow(/positive ascending integers/);

    const narration = Array.from({ length: MAX_NARRATION_WORDS + 1 }, () => "word").join(" ");
    expect(() =>
      validateStoryboard({
        title: "Too long",
        scenes: Array.from({ length: 12 }, (_, index) => ({
          kind: "title",
          narration: narration
            .split(" ")
            .slice(index * 334, (index + 1) * 334)
            .join(" "),
        })),
      }),
    ).toThrow(/total narration must be at most 4000 words/);
  });
});

describe("generateSceneHtml", () => {
  it("escapes content and highlights the selected code range", () => {
    const html = generateSceneHtml(
      "Unsafe <script>",
      {
        kind: "code",
        file: "src/<api>.ts",
        highlight: [2, 2],
        narration: "Narration",
      },
      2,
      5,
      { code: 'const value = "<unsafe>";\nreturn value;' },
    );

    expect(html).not.toContain("<script>");
    expect(html).toContain("src/&lt;api&gt;.ts");
    expect(html).toContain("&quot;&lt;unsafe&gt;&quot;");
    expect(html.match(/code-line selected/g)).toHaveLength(1);
    expect(html).toContain('<span class="syntax-keyword">return</span>');
    expect(html).toContain("2 / 5");
  });

  it("degrades a diagram to styled Mermaid source when no renderer is available", () => {
    const html = generateSceneHtml(
      "Architecture",
      { kind: "diagram", mermaid: "graph LR; A-->B", narration: "Narration" },
      1,
      1,
    );

    expect(html).toContain("mermaid-fallback");
    expect(html).toContain("graph LR; A--&gt;B");
    expect(html).toContain("Diagram preview unavailable");
  });
});
