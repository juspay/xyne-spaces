export const MAX_SCENES = 12;
export const MAX_NARRATION_WORDS = 4_000;
export const MAX_SCENE_NARRATION_CHARS = 2_000;
export const MAX_ANIMATION_SOURCE_CHARS = 20_000;
export const MAX_D2_STEPS = 8;

/**
 * Tail padding added to every segment after the narration/animation ends, in
 * seconds. Kept here (not in the composer) so the timing math is pure and
 * unit-testable without ffmpeg.
 */
export const SEGMENT_PAD_SECONDS = 0.8;

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
/**
 * A Manim animation scene. `source` is a full Manim (Community, Cairo
 * renderer) Python script; `scene` is the Scene subclass to render. Both run
 * inside the sealed studio sandbox — no repo, no network, no credentials —
 * so untrusted model-authored Python never touches a privileged box. `scene`
 * is interpolated into the manim command line, so it is restricted to a valid
 * Python identifier; `source` is only ever written to a file, never shelled.
 */
export type ManimScene = {
  kind: "manim";
  source: string;
  scene: string;
  narration: string;
};
/**
 * A D2 architecture/data-flow scene. `steps` is an ordered list of D2 board
 * snapshots; each is rendered offline (d2 → SVG → rsvg-convert → PNG) and the
 * boards are faded together into a progressive reveal. One step renders a
 * single fade-in board. Every source is written to a file, never shelled.
 */
export type D2Scene = {
  kind: "d2";
  steps: string[];
  narration: string;
};
export type VideoScene =
  | TitleScene
  | DiagramScene
  | CodeScene
  | DiffScene
  | BulletsScene
  | ManimScene
  | D2Scene;

export const ANIMATED_SCENE_KINDS: ReadonlySet<VideoScene["kind"]> = new Set([
  "manim",
  "d2",
]);

export function isAnimatedScene(scene: VideoScene): scene is ManimScene | D2Scene {
  return ANIMATED_SCENE_KINDS.has(scene.kind);
}

export interface Storyboard {
  title: string;
  voice?: string;
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
    case "manim": {
      const sceneClass = string(scene["scene"], `scenes[${index}].scene`, 200);
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(sceneClass)) {
        throw new StoryboardValidationError(
          `scenes[${index}].scene must be a valid Python class name (letters, digits, underscore; not starting with a digit)`,
        );
      }
      return {
        kind: "manim",
        source: string(scene["source"], `scenes[${index}].source`, MAX_ANIMATION_SOURCE_CHARS),
        scene: sceneClass,
        narration: sceneNarration,
      };
    }
    case "d2": {
      const steps = scene["steps"];
      if (!Array.isArray(steps) || steps.length === 0 || steps.length > MAX_D2_STEPS) {
        throw new StoryboardValidationError(
          `scenes[${index}].steps must contain between 1 and ${MAX_D2_STEPS} D2 sources`,
        );
      }
      return {
        kind: "d2",
        steps: steps.map((step, stepIndex) =>
          string(step, `scenes[${index}].steps[${stepIndex}]`, MAX_ANIMATION_SOURCE_CHARS),
        ),
        narration: sceneNarration,
      };
    }
    default:
      throw new StoryboardValidationError(
        `scenes[${index}].kind must be title, diagram, code, diff, bullets, manim, or d2`,
      );
  }
}

export function countWords(text: string): number {
  return text.trim() ? text.trim().split(/\s+/).length : 0;
}

/**
 * Narration-first timing, unified for static and animated scenes. Narration is
 * never cut and (for animated scenes) the animation is never cut: the segment
 * runs for the longer of the two plus a fixed tail. The composer freezes the
 * animation's last frame and pads the audio with silence to fill this length.
 */
export function computeSegmentSeconds(narrationSeconds: number, animationSeconds = 0): number {
  const base = Math.max(
    Number.isFinite(narrationSeconds) ? narrationSeconds : 0,
    Number.isFinite(animationSeconds) ? animationSeconds : 0,
  );
  return Number((base + SEGMENT_PAD_SECONDS).toFixed(3));
}

export function validateStoryboard(value: unknown): Storyboard {
  const input = record(value, "storyboard");
  const title = string(input["title"], "title", 200);
  const voiceValue = input["voice"];
  if (voiceValue !== undefined && (typeof voiceValue !== "string" || !voiceValue.trim())) {
    throw new StoryboardValidationError("voice must be a non-empty string");
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
    ...(typeof voiceValue === "string" && voiceValue.trim() !== "default"
      ? { voice: voiceValue.trim() }
      : {}),
    scenes,
  };
}
