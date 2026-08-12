import type { ChartArtifact } from "../flow/builder.js";
import type { Todo } from "../flow/plan-flow.js";
import type { PrProvider, PrStatus } from "../flow/pr-flow.js";

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

export interface UserQuestion {
  id: string;
  label?: string;
  question: string;
  type: UserQuestionType;
  options?: string[];
  required?: boolean;
  placeholder?: string;
}

interface UiWidgetBase {
  /** Stable within a run. Used to make create events idempotent. */
  id: string;
}

export interface PrWidgetPayload {
  provider: PrProvider;
  status: PrStatus;
  title: string;
  url?: string;
  desc?: string;
  ticketId?: string;
  detailsUrl?: string;
  number?: string | number;
  repo?: string;
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
      type: "pr";
      operation: "upsert";
      payload: PrWidgetPayload;
    });

export type UiWidgetType = UiWidget["type"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function isQuestion(value: unknown): value is UserQuestion {
  if (!isRecord(value)) return false;
  if (typeof value["id"] !== "string" || typeof value["question"] !== "string") return false;
  const type = value["type"];
  if (type !== "single_choice" && type !== "multiple_choice" && type !== "open_ended") return false;
  if (value["label"] !== undefined && typeof value["label"] !== "string") return false;
  if (value["required"] !== undefined && typeof value["required"] !== "boolean") return false;
  if (value["placeholder"] !== undefined && typeof value["placeholder"] !== "string") return false;
  return value["options"] === undefined || (Array.isArray(value["options"]) && value["options"].every((item) => typeof item === "string"));
}

function hasValidChartPayload(payload: Record<string, unknown>): boolean {
  const type = payload["type"];
  if (type === "line" || type === "area") {
    return Array.isArray(payload["series"]) && payload["series"].length > 0 && payload["series"].every((row) =>
      isRecord(row) && typeof row["x"] === "string" && typeof row["y"] === "number" && Number.isFinite(row["y"]),
    );
  }
  if (type === "bar" || type === "pie" || type === "donut") {
    return Array.isArray(payload["points"]) && payload["points"].length > 0 && payload["points"].every((point) =>
      isRecord(point) && typeof point["label"] === "string" && typeof point["value"] === "number" && Number.isFinite(point["value"]),
    );
  }
  return false;
}

const PR_PROVIDERS = new Set(["github", "bitbucket", "gitlab", "other"]);
const PR_STATUSES = new Set(["created", "merged", "reverted", "deleted", "declined"]);

function hasValidPrPayload(payload: Record<string, unknown>): boolean {
  if (typeof payload["provider"] !== "string" || !PR_PROVIDERS.has(payload["provider"])) return false;
  if (typeof payload["status"] !== "string" || !PR_STATUSES.has(payload["status"])) return false;
  if (typeof payload["title"] !== "string" || !payload["title"].trim()) return false;
  for (const field of ["url", "desc", "ticketId", "detailsUrl", "repo"] as const) {
    const value = payload[field];
    if (value !== undefined && (typeof value !== "string" || !value.trim())) return false;
  }
  const number = payload["number"];
  return number === undefined ||
    (typeof number === "string" && !!number.trim()) ||
    (typeof number === "number" && Number.isFinite(number));
}

export function isUiWidget(value: unknown): value is UiWidget {
  if (!isRecord(value)) return false;
  const candidate = value;
  if (typeof candidate.id !== "string" || !candidate.id.trim()) return false;
  if (!isRecord(candidate.payload)) return false;
  const payload = candidate.payload;
  if (candidate.type === "plan") {
    return candidate.operation === "upsert" && Array.isArray(payload["todos"]) && payload["todos"].every((todo) =>
      isRecord(todo) &&
      typeof todo["id"] === "string" &&
      typeof todo["title"] === "string" &&
      (todo["status"] === "pending" || todo["status"] === "in_progress" || todo["status"] === "completed" || todo["status"] === "failed"),
    );
  }
  if (candidate.type === "pr") {
    return candidate.operation === "upsert" && hasValidPrPayload(payload);
  }
  if (candidate.operation !== "create") return false;
  if (candidate.type === "question") {
    return typeof payload["questionId"] === "string" &&
      Array.isArray(payload["questions"]) && payload["questions"].length > 0 && payload["questions"].every(isQuestion);
  }
  if (candidate.type === "code") {
    return typeof payload["code"] === "string" &&
      (payload["language"] === undefined || typeof payload["language"] === "string");
  }
  if (candidate.type === "diff") return typeof payload["path"] === "string" && typeof payload["patch"] === "string";
  if (candidate.type === "chart") return hasValidChartPayload(payload);
  return false;
}
