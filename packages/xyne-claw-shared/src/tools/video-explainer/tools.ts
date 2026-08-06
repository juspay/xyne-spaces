import type { ToolDefinition } from "../types.js";
import { SANDBOX_CONFIG_SCHEMA } from "../sandbox/index.js";
import { composeVideo, currentSandbox } from "./composer.js";
import {
  StoryboardValidationError,
  type Storyboard,
  validateStoryboard,
} from "./storyboard.js";

export const createVideoExplainer: ToolDefinition = {
  slug: "create-video-explainer",
  name: "Create Video Explainer",
  description:
    "Render an approved storyboard into a narrated MP4 inside the current writable sandbox. " +
    "Scene kinds: title, diagram (mermaid), code, diff, bullets, and the animated kinds " +
    "manim (a Manim/Cairo Python scene) and d2 (an ordered list of D2 architecture board " +
    "snapshots faded into a progressive reveal). Every engine renders in this same sandbox — " +
    "no separate box — and needs no internet: narration TTS is fetched by the runtime and " +
    "injected as a file. Always show the storyboard to the user and obtain approval before " +
    "calling this tool. After it succeeds, deliver the returned filePath with sandbox-deliver-files.",
  source: "custom:sandbox",
  configSchema: SANDBOX_CONFIG_SCHEMA,
  inputSchema: {
    type: "object",
    properties: {
      title: { type: "string", maxLength: 200 },
      voice: {
        type: "string",
        description: "Optional Azure TTS voice. Use 'default' to use the configured voice.",
      },
      scenes: {
        type: "array",
        minItems: 1,
        maxItems: 12,
        items: {
          oneOf: [
            {
              type: "object",
              properties: {
                kind: { const: "title" },
                narration: { type: "string", maxLength: 2_000 },
              },
              required: ["kind", "narration"],
            },
            {
              type: "object",
              properties: {
                kind: { const: "diagram" },
                mermaid: { type: "string" },
                narration: { type: "string", maxLength: 2_000 },
              },
              required: ["kind", "mermaid", "narration"],
            },
            {
              type: "object",
              properties: {
                kind: { const: "code" },
                file: { type: "string" },
                highlight: {
                  type: "array",
                  items: { type: "integer", minimum: 1 },
                  minItems: 2,
                  maxItems: 2,
                },
                narration: { type: "string", maxLength: 2_000 },
              },
              required: ["kind", "file", "highlight", "narration"],
            },
            {
              type: "object",
              properties: {
                kind: { const: "diff" },
                before: { type: "string" },
                after: { type: "string" },
                narration: { type: "string", maxLength: 2_000 },
              },
              required: ["kind", "before", "after", "narration"],
            },
            {
              type: "object",
              properties: {
                kind: { const: "bullets" },
                items: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 12 },
                narration: { type: "string", maxLength: 2_000 },
              },
              required: ["kind", "items", "narration"],
            },
            {
              type: "object",
              properties: {
                kind: { const: "manim" },
                source: {
                  type: "string",
                  description:
                    "A full Manim Community (Cairo renderer) Python script. Rendered at 1080p/30fps in this sandbox.",
                },
                scene: {
                  type: "string",
                  description: "The Scene subclass name to render (a valid Python identifier).",
                },
                narration: { type: "string", maxLength: 2_000 },
              },
              required: ["kind", "source", "scene", "narration"],
            },
            {
              type: "object",
              properties: {
                kind: { const: "d2" },
                steps: {
                  type: "array",
                  items: { type: "string" },
                  minItems: 1,
                  maxItems: 8,
                  description:
                    "Ordered D2 board snapshots. Each is rendered offline and faded into the next as a progressive architecture reveal.",
                },
                narration: { type: "string", maxLength: 2_000 },
              },
              required: ["kind", "steps", "narration"],
            },
          ],
        },
      },
    },
    required: ["title", "scenes"],
  },

  async execute(params, context) {
    if (!context) return "Error: No execution context available.";
    let storyboard: Storyboard;
    try {
      storyboard = validateStoryboard(params);
    } catch (error) {
      if (error instanceof StoryboardValidationError) {
        return JSON.stringify({ error: error.message });
      }
      return JSON.stringify({ error: "Invalid storyboard" });
    }
    const session = currentSandbox(context);
    if (!session) {
      return JSON.stringify({
        error:
          "No writable sandbox session is active for this conversation. Run sandbox-create or sandbox-repo-setup with write:true, then retry.",
      });
    }
    try {
      const composition = await composeVideo(session, context, storyboard);
      return JSON.stringify({
        filePath: composition.outputPath,
        mimeType: "video/mp4",
        totalSeconds: Number(
          composition.scenes.reduce((total, scene) => total + scene.segmentSeconds, 0).toFixed(2),
        ),
        scenes: composition.scenes,
        next: `Call sandbox-deliver-files with path ${composition.outputPath}.`,
      });
    } catch (error) {
      return JSON.stringify({
        error: error instanceof Error ? error.message : "Video composition failed",
      });
    }
  },
};
