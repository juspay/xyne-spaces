import type { ToolDefinition } from "../types.js";
import { SANDBOX_CONFIG_SCHEMA } from "../sandbox/index.js";
import { composeVideo, currentSandbox, OUTPUT_PATH } from "./composer.js";
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
    "Always show the storyboard to the user and obtain approval before calling this tool. " +
    "After it succeeds, deliver the returned filePath with sandbox-deliver-files.",
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
      const scenes = await composeVideo(session, context, storyboard);
      return JSON.stringify({
        filePath: OUTPUT_PATH,
        mimeType: "video/mp4",
        totalSeconds: Number(
          scenes.reduce((total, scene) => total + scene.segmentSeconds, 0).toFixed(2),
        ),
        scenes,
        next: `Call sandbox-deliver-files with path ${OUTPUT_PATH}.`,
      });
    } catch (error) {
      return JSON.stringify({
        error: error instanceof Error ? error.message : "Video composition failed",
      });
    }
  },
};
