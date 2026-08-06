import type { Session } from "@xyne/kata-sdk";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ToolExecutionContext } from "../types.js";
import { buildD2TransitionPlan, composeVideo } from "./composer.js";
import { validateStoryboard } from "./storyboard.js";

interface MockSession {
  session: Session;
  commands: string[];
  writes: string[];
}

function mockSession(failOn?: RegExp): MockSession {
  const commands: string[] = [];
  const writes: string[] = [];
  const session = {
    commands: {
      run: vi.fn(async (command: string) => {
        commands.push(command);
        if (failOn?.test(command)) {
          return { exitCode: 1, stdout: "", stderr: "renderer failed" };
        }
        if (command.startsWith("find ")) {
          const mediaDir = command.match(/^find '([^']+)'/)?.[1];
          return {
            exitCode: 0,
            stdout: mediaDir ? `${mediaDir}/videos/manim-1/1080p30/out.mp4\n` : "",
            stderr: "",
          };
        }
        if (command.startsWith("ffprobe ")) {
          return {
            exitCode: 0,
            stdout: command.includes(".mp3") ? "1.500\n" : "4.400\n",
            stderr: "",
          };
        }
        return { exitCode: 0, stdout: "", stderr: "" };
      }),
    },
    files: {
      write: vi.fn(async (path: string) => {
        writes.push(path);
      }),
    },
  } as unknown as Session;
  return { session, commands, writes };
}

const context: ToolExecutionContext = {
  config: {},
  s2sKey: "test-s2s-key",
  meta: { userId: "u1", conversationId: "c1", agentSlug: "a1" },
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("buildD2TransitionPlan", () => {
  it("crossfades boards instead of concatenating independent fade-ins", () => {
    const plan = buildD2TransitionPlan(3);

    expect(plan.filterComplex).toContain(
      "[board0][board1]xfade=transition=fade:duration=0.4:offset=2.000[reveal1]",
    );
    expect(plan.filterComplex).toContain(
      "[reveal1][board2]xfade=transition=fade:duration=0.4:offset=4.000[reveal2]",
    );
    expect(plan.outputLabel).toBe("reveal2");
    expect(plan.durationSeconds).toBeCloseTo(6.4);
  });

  it("keeps a single board as a simple fade-in", () => {
    const plan = buildD2TransitionPlan(1);
    expect(plan.filterComplex).toContain("fade=t=in:st=0:d=0.4");
    expect(plan.filterComplex).not.toContain("xfade=");
    expect(plan.outputLabel).toBe("board0");
    expect(plan.durationSeconds).toBe(2.4);
  });
});

describe("composeVideo renderer orchestration", () => {
  it("uses an isolated render directory, crossfades D2, and removes intermediates", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({ success: true, data: { audioBase64: Buffer.from("audio").toString("base64") } }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      ),
    );
    const mock = mockSession();
    const storyboard = validateStoryboard({
      title: "Animated explainer",
      scenes: [
        {
          kind: "manim",
          source: "from manim import *\nclass Demo(Scene):\n    def construct(self):\n        pass",
          scene: "Demo",
          narration: "Manim narration.",
        },
        {
          kind: "d2",
          steps: ["a -> b", "a -> b -> c"],
          narration: "D2 narration.",
        },
      ],
    });

    const result = await composeVideo(mock.session, context, storyboard);
    const renderId = result.outputPath.match(/explainer-([0-9a-f-]+)\.mp4$/)?.[1];

    expect(renderId).toBeTruthy();
    const workDir = `/home/nixuser/workspace/.video-explainer/${renderId}`;
    expect(mock.writes.every((path) => path.startsWith(workDir))).toBe(true);
    expect(mock.commands.some((command) => command.includes("manim --renderer=cairo"))).toBe(true);
    expect(mock.commands.some((command) => command.includes("D2_LAYOUT=dagre d2"))).toBe(true);
    expect(mock.commands.some((command) => command.includes("rsvg-convert"))).toBe(true);
    expect(mock.commands.some((command) => command.includes("xfade=transition=fade"))).toBe(true);
    expect(mock.commands.some((command) => command.includes("tpad=stop_mode=clone"))).toBe(true);
    expect(mock.commands.some((command) => command.includes("[1:a]apad[a]"))).toBe(true);
    expect(mock.commands.some((command) => command.includes("-f concat") && command.includes(workDir))).toBe(true);
    expect(mock.commands.at(-1)).toBe(`rm -rf -- '${workDir}'`);
    expect(result.scenes.map((scene) => scene.kind)).toEqual(["manim", "d2"]);
  });

  it("uses different paths for repeated renders and cleans up after renderer failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({ success: true, data: { audioBase64: Buffer.from("audio").toString("base64") } }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      ),
    );
    const storyboard = validateStoryboard({
      title: "Static explainer",
      scenes: [{ kind: "title", narration: "Hello." }],
    });
    const first = mockSession();
    const second = mockSession();

    const firstResult = await composeVideo(first.session, context, storyboard);
    const secondResult = await composeVideo(second.session, context, storyboard);
    expect(firstResult.outputPath).not.toBe(secondResult.outputPath);
    expect(first.writes.some((path) => path.endsWith(".ass"))).toBe(false);
    expect(first.commands.some((command) => command.includes("subtitles="))).toBe(false);
    expect(second.writes.some((path) => path.endsWith(".ass"))).toBe(false);
    expect(second.commands.some((command) => command.includes("subtitles="))).toBe(false);

    const failing = mockSession(/manim --renderer=cairo/);
    const manimStoryboard = validateStoryboard({
      title: "Failure",
      scenes: [
        {
          kind: "manim",
          source: "from manim import *\nclass Demo(Scene):\n    def construct(self):\n        pass",
          scene: "Demo",
          narration: "Hello.",
        },
      ],
    });
    await expect(composeVideo(failing.session, context, manimStoryboard)).rejects.toThrow(
      "renderer failed",
    );
    expect(failing.commands.at(-1)).toMatch(/^rm -rf -- '\/home\/nixuser\/workspace\/\.video-explainer\//);
  });
});
