import type { ChartArtifact } from "../flow/builder.js";
import type { Todo } from "../flow/plan-flow.js";

/**
 * Domain payloads that the claw runtime may ask a UI surface to render.
 *
 * Keep this contract independent from Flow JSON. The runtime supplies trusted,
 * typed data; claw-auth owns routing, action signatures, and construction of
 * the actual Flow definition for the target surface.
 *
 * Adding a future widget should require:
 *   1. one variant here,
 *   2. one producer that calls ToolExecutionContext.emitUiWidget, and
 *   3. one renderer branch in claw-auth.
 * The HTTP and SSE transports do not need another widget-specific pathway.
 */

export type UserQuestionType = "single_choice" | "multiple_choice" | "open_ended";

/** An option carrying a secondary line under its label. */
export interface UserQuestionOption {
  label: string;
  description?: string;
}

/** A single feedback button: visible label + captured machine value, with an
 * optional mapping onto the run's up/down rating. */
export interface FeedbackOption {
  label: string;
  value: string;
  sentiment?: "up" | "down";
}

export interface UserQuestion {
  id: string;
  label?: string;
  question: string;
  type: UserQuestionType;
  options?: (string | UserQuestionOption)[];
  required?: boolean;
  placeholder?: string;
}

/** The stored/submitted answer value for an option, whichever form it takes. */
export function userQuestionOptionLabel(option: string | UserQuestionOption): string {
  return typeof option === "string" ? option : option.label;
}

interface UiWidgetBase {
  /** Stable within a run. Used to make create events idempotent. */
  id: string;
}

export type UiWidget =
  | (UiWidgetBase & {
      type: "plan";
      operation: "upsert";
      payload: { todos: Todo[] };
    })
  | (UiWidgetBase & {
      type: "question";
      operation: "create";
      payload: { questionId: string; questions: UserQuestion[] };
    })
  | (UiWidgetBase & {
      type: "code";
      operation: "create";
      payload: { code: string; language?: string };
    })
  | (UiWidgetBase & {
      type: "diff";
      operation: "create";
      payload: { path: string; patch: string };
    })
  | (UiWidgetBase & {
      type: "chart";
      operation: "create";
      payload: ChartArtifact;
    })
  | (UiWidgetBase & {
      type: "feedback";
      operation: "create";
      payload: { feedbackId: string; sessionId: string; prompt: string; options: FeedbackOption[] };
    });

export type UiWidgetType = UiWidget["type"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

/**
 * Bounds mirrored from `packages/shared/src/validation/flowSchema.ts`. That zod
 * schema is the authority — it runs at the Spaces `/chat/postMessage` boundary,
 * far downstream of the tool that produced the widget, so a mismatch here means
 * a card that passes this guard and is then silently rejected with no signal
 * reaching the model. Keep the two in step.
 */
const MAX_QUESTIONS = 8;
const MIN_CHOICE_OPTIONS = 2;
// 8 author-supplied options + the "Skip this question" entry the tool appends.
const MAX_CHOICE_OPTIONS = 9;
const MAX_CHART_CATEGORY_POINTS = 24;
const MAX_CHART_SERIES_POINTS = 200;

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/** Returns null when valid, else a reason phrased for the tool author (the model). */
function questionError(value: unknown, index: number): string | null {
  const at = `question ${index + 1}`;
  if (!isRecord(value)) return `${at} is not an object`;
  if (!isNonEmptyString(value["id"])) return `${at} needs a non-empty id`;
  if (!isNonEmptyString(value["question"])) return `${at} needs a non-empty question`;
  const type = value["type"];
  if (type !== "single_choice" && type !== "multiple_choice" && type !== "open_ended") {
    return `${at} has type ${JSON.stringify(type)}; expected single_choice, multiple_choice or open_ended`;
  }
  if (value["label"] !== undefined && !isNonEmptyString(value["label"])) return `${at} label must be a non-empty string`;
  if (value["required"] !== undefined && typeof value["required"] !== "boolean") return `${at} required must be a boolean`;
  if (value["placeholder"] !== undefined && typeof value["placeholder"] !== "string") return `${at} placeholder must be a string`;

  const options = value["options"];
  if (type === "open_ended") {
    // flowSchema's open_ended variant is .strict() with no `options` key at all.
    if (options !== undefined) return `${at} is open_ended and must not carry options`;
    return null;
  }
  if (!Array.isArray(options)) return `${at} is ${type} and needs an options array`;
  if (options.length < MIN_CHOICE_OPTIONS || options.length > MAX_CHOICE_OPTIONS) {
    return `${at} has ${options.length} options; expected ${MIN_CHOICE_OPTIONS}-${MAX_CHOICE_OPTIONS}`;
  }
  for (let i = 0; i < options.length; i += 1) {
    const option = options[i];
    if (isNonEmptyString(option)) continue;
    if (isRecord(option) && isNonEmptyString(option["label"])) {
      const description = option["description"];
      if (description !== undefined && !isNonEmptyString(description)) {
        return `${at} option ${i + 1} has an empty description; omit it instead`;
      }
      continue;
    }
    return `${at} option ${i + 1} must be a non-empty label string or { label, description }`;
  }
  return null;
}

function chartPayloadError(payload: Record<string, unknown>): string | null {
  const type = payload["type"];
  if (payload["caption"] !== undefined && !isNonEmptyString(payload["caption"])) {
    return "caption must be a non-empty string when present";
  }
  if (type === "line" || type === "area") {
    const series = payload["series"];
    if (!Array.isArray(series) || series.length === 0) return `${type} charts need a non-empty series array`;
    if (series.length > MAX_CHART_SERIES_POINTS) {
      return `${series.length} series points exceeds the ${MAX_CHART_SERIES_POINTS} limit; aggregate first`;
    }
    const bad = series.findIndex((row) =>
      !isRecord(row) ||
      !isNonEmptyString(row["x"]) ||
      typeof row["y"] !== "number" ||
      !Number.isFinite(row["y"]) ||
      (row["series"] !== undefined && !isNonEmptyString(row["series"])),
    );
    return bad === -1 ? null : `series point ${bad + 1} needs a non-empty x and a finite numeric y`;
  }
  if (type === "bar" || type === "pie" || type === "donut") {
    const points = payload["points"];
    if (!Array.isArray(points) || points.length === 0) return `${type} charts need a non-empty points array`;
    if (points.length > MAX_CHART_CATEGORY_POINTS) {
      return `${points.length} points exceeds the ${MAX_CHART_CATEGORY_POINTS} limit; aggregate or trim first`;
    }
    const bad = points.findIndex((point) =>
      !isRecord(point) ||
      !isNonEmptyString(point["label"]) ||
      typeof point["value"] !== "number" ||
      !Number.isFinite(point["value"]),
    );
    return bad === -1 ? null : `point ${bad + 1} needs a non-empty label and a finite numeric value`;
  }
  return `chart type ${JSON.stringify(type)} is not one of bar, line, area, pie, donut`;
}

/**
 * Explain why `value` is not a renderable widget, or null when it is.
 *
 * Producers should call this BEFORE dispatch (publishUiWidget does) so an
 * invalid card surfaces as a tool error the model can correct, rather than
 * being dropped downstream where nothing reports back to it.
 */
export function uiWidgetValidationError(value: unknown): string | null {
  if (!isRecord(value)) return "widget is not an object";
  const candidate = value;
  if (!isNonEmptyString(candidate["id"])) return "widget needs a non-empty id";
  if (!isRecord(candidate["payload"])) return "widget needs a payload object";
  const payload = candidate["payload"];

  if (candidate["type"] === "plan") {
    if (candidate["operation"] !== "upsert") return "plan widgets use operation 'upsert'";
    const todos = payload["todos"];
    if (!Array.isArray(todos)) return "plan payload needs a todos array";
    const bad = todos.findIndex((todo) =>
      !isRecord(todo) ||
      !isNonEmptyString(todo["id"]) ||
      !isNonEmptyString(todo["title"]) ||
      (todo["status"] !== "pending" && todo["status"] !== "in_progress" && todo["status"] !== "completed" && todo["status"] !== "failed"),
    );
    return bad === -1 ? null : `todo ${bad + 1} needs an id, a title, and a status of pending|in_progress|completed|failed`;
  }

  if (candidate["operation"] !== "create") {
    return `${String(candidate["type"])} widgets use operation 'create'`;
  }

  if (candidate["type"] === "question") {
    if (!isNonEmptyString(payload["questionId"])) return "question payload needs a questionId";
    const questions = payload["questions"];
    if (!Array.isArray(questions) || questions.length === 0) return "question payload needs a non-empty questions array";
    if (questions.length > MAX_QUESTIONS) return `${questions.length} questions exceeds the ${MAX_QUESTIONS} limit`;
    const ids = new Set<string>();
    for (let i = 0; i < questions.length; i += 1) {
      const error = questionError(questions[i], i);
      if (error) return error;
      const id = (questions[i] as Record<string, unknown>)["id"] as string;
      if (ids.has(id)) return `duplicate question id ${JSON.stringify(id)}`;
      ids.add(id);
    }
    return null;
  }

  if (candidate["type"] === "feedback") {
    if (!isNonEmptyString(payload["feedbackId"])) return "feedback payload needs a feedbackId";
    if (!isNonEmptyString(payload["sessionId"])) return "feedback payload needs a sessionId";
    if (!isNonEmptyString(payload["prompt"])) return "feedback payload needs a prompt";
    const options = payload["options"];
    if (!Array.isArray(options) || options.length < 2 || options.length > 6) {
      return "feedback payload needs 2-6 options";
    }
    const values = new Set<string>();
    for (let i = 0; i < options.length; i += 1) {
      const option = options[i];
      if (!isRecord(option) || !isNonEmptyString(option["label"]) || !isNonEmptyString(option["value"])) {
        return `feedback option ${i + 1} needs a non-empty label and value`;
      }
      const sentiment = option["sentiment"];
      if (sentiment !== undefined && sentiment !== "up" && sentiment !== "down") {
        return `feedback option ${i + 1} sentiment must be "up" or "down" when present`;
      }
      const value = option["value"] as string;
      if (values.has(value)) return `duplicate feedback option value ${JSON.stringify(value)}`;
      values.add(value);
    }
    return null;
  }

  if (candidate["type"] === "code") {
    if (!isNonEmptyString(payload["code"])) return "code payload needs a non-empty code string";
    if (payload["language"] !== undefined && !isNonEmptyString(payload["language"])) {
      return "language must be a non-empty string when present; omit it instead";
    }
    return null;
  }

  if (candidate["type"] === "diff") {
    if (!isNonEmptyString(payload["path"])) return "diff payload needs a non-empty path";
    if (!isNonEmptyString(payload["patch"])) return "diff payload needs a non-empty patch";
    return null;
  }

  if (candidate["type"] === "chart") return chartPayloadError(payload);

  return `unknown widget type ${JSON.stringify(candidate["type"])}`;
}

export function isUiWidget(value: unknown): value is UiWidget {
  return uiWidgetValidationError(value) === null;
}
