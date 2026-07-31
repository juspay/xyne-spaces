export const MAX_SCENES = 12;
export const MAX_NARRATION_WORDS = 4_000;
export const MAX_SCENE_NARRATION_CHARS = 2_000;

export type TitleScene = { kind: "title"; narration: string };
export type DiagramScene = { kind: "diagram"; mermaid: string; narration: string };
export type CodeScene = {
  kind: "code";
  file: string;
  highlight: [number, number];
  narration: string;
};
export type DiffScene = {
  kind: "diff";
  before: string;
  after: string;
  narration: string;
};
export type BulletsScene = { kind: "bullets"; items: string[]; narration: string };
export type VideoScene = TitleScene | DiagramScene | CodeScene | DiffScene | BulletsScene;

export type Renderer = "slides" | "motion";

// Visual theme for the rendered frames. "light" (default) is a minimal, clean
// background suited to product/launch videos; "dark" is the original tech look.
export type Theme = "light" | "dark";

export interface Storyboard {
  title: string;
  voice?: string;
  renderer: Renderer;
  theme: Theme;
  scenes: VideoScene[];
}

export class StoryboardValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StoryboardValidationError";
  }
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new StoryboardValidationError(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function string(value: unknown, label: string, maxLength = 20_000): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new StoryboardValidationError(`${label} must be a non-empty string`);
  }
  if (value.length > maxLength) {
    throw new StoryboardValidationError(`${label} must be at most ${maxLength} characters`);
  }
  return value;
}

function narration(scene: Record<string, unknown>, index: number): string {
  return string(
    scene["narration"],
    `scenes[${index}].narration`,
    MAX_SCENE_NARRATION_CHARS,
  );
}

function parseScene(value: unknown, index: number): VideoScene {
  const scene = record(value, `scenes[${index}]`);
  const sceneNarration = narration(scene, index);
  switch (scene["kind"]) {
    case "title":
      return { kind: "title", narration: sceneNarration };
    case "diagram":
      return {
        kind: "diagram",
        mermaid: string(scene["mermaid"], `scenes[${index}].mermaid`),
        narration: sceneNarration,
      };
    case "code": {
      const highlight = scene["highlight"];
      if (
        !Array.isArray(highlight) ||
        highlight.length !== 2 ||
        !highlight.every((line) => Number.isInteger(line) && Number(line) > 0) ||
        Number(highlight[0]) > Number(highlight[1])
      ) {
        throw new StoryboardValidationError(
          `scenes[${index}].highlight must be [startLine, endLine] with positive ascending integers`,
        );
      }
      return {
        kind: "code",
        file: string(scene["file"], `scenes[${index}].file`, 1_000),
        highlight: [Number(highlight[0]), Number(highlight[1])],
        narration: sceneNarration,
      };
    }
    case "diff":
      return {
        kind: "diff",
        before: string(scene["before"], `scenes[${index}].before`),
        after: string(scene["after"], `scenes[${index}].after`),
        narration: sceneNarration,
      };
    case "bullets": {
      const items = scene["items"];
      if (!Array.isArray(items) || items.length === 0 || items.length > 12) {
        throw new StoryboardValidationError(
          `scenes[${index}].items must contain between 1 and 12 bullets`,
        );
      }
      return {
        kind: "bullets",
        items: items.map((item, itemIndex) =>
          string(item, `scenes[${index}].items[${itemIndex}]`, 500),
        ),
        narration: sceneNarration,
      };
    }
    default:
      throw new StoryboardValidationError(
        `scenes[${index}].kind must be title, diagram, code, diff, or bullets`,
      );
  }
}

export function countWords(text: string): number {
  return text.trim() ? text.trim().split(/\s+/).length : 0;
}

export function validateStoryboard(value: unknown): Storyboard {
  const input = record(value, "storyboard");
  const title = string(input["title"], "title", 200);
  const voiceValue = input["voice"];
  if (voiceValue !== undefined && (typeof voiceValue !== "string" || !voiceValue.trim())) {
    throw new StoryboardValidationError("voice must be a non-empty string");
  }
  const rendererValue = input["renderer"];
  let renderer: Renderer = "slides";
  if (rendererValue !== undefined) {
    if (rendererValue !== "slides" && rendererValue !== "motion") {
      throw new StoryboardValidationError('renderer must be "slides" or "motion"');
    }
    renderer = rendererValue;
  }
  const themeValue = input["theme"];
  let theme: Theme = "light";
  if (themeValue !== undefined) {
    if (themeValue !== "light" && themeValue !== "dark") {
      throw new StoryboardValidationError('theme must be "light" or "dark"');
    }
    theme = themeValue;
  }
  const scenesValue = input["scenes"];
  if (
    !Array.isArray(scenesValue) ||
    scenesValue.length === 0 ||
    scenesValue.length > MAX_SCENES
  ) {
    throw new StoryboardValidationError(`scenes must contain between 1 and ${MAX_SCENES} scenes`);
  }
  const scenes = scenesValue.map(parseScene);
  const narrationWords = scenes.reduce((total, scene) => total + countWords(scene.narration), 0);
  if (narrationWords > MAX_NARRATION_WORDS) {
    throw new StoryboardValidationError(
      `total narration must be at most ${MAX_NARRATION_WORDS} words (received ${narrationWords})`,
    );
  }
  return {
    title,
    renderer,
    theme,
    ...(typeof voiceValue === "string" && voiceValue.trim() !== "default"
      ? { voice: voiceValue.trim() }
      : {}),
    scenes,
  };
}
