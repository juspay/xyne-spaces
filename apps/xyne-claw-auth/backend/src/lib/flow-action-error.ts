/**
 * Turns a failed approval-tool execution into a typed, user-readable
 * `AppActionResponse` error (XYNE-66467).
 *
 * Before this, every tool failure went out as
 *   422 { code: "TOOL_EXECUTION_FAILED", message: "Edit canvas error: Spaces API 403: {...}" }
 * so a plain permission problem looked like a platform outage. The HTTP status
 * of the upstream call is the single best signal of what went wrong, so we keep
 * it (from `SpacesApiError.status`, the MCP `_meta.httpStatus` the runner lifts
 * onto the thrown error, the gateway's `backendStatus`, or — as a last resort —
 * the historical `Spaces API <status>:` message prefix) and map it to a stable
 * code from `@xyne/shared`.
 *
 * The raw upstream text is for logs only; it never reaches the user.
 */
import {
  FLOW_ACTION_ERROR_DEFAULT_MESSAGES,
  flowActionErrorCodeFromStatus,
  isRetryableFlowActionError,
  type FlowActionErrorCode,
} from "@xyne/shared/flow-action-errors";
import { errMsg } from "./errors.js";

export interface FlowActionErrorResponse {
  type: "error";
  code: FlowActionErrorCode;
  message: string;
  retryable: boolean;
}

export interface ClassifyToolErrorContext {
  /** Tool name, e.g. `spaces-edit-canvas` — used to pick resource-specific copy. */
  tool: string;
  /** HTTP status known out-of-band (e.g. the MCP gateway's `backendStatus`). */
  status?: number;
}

const SPACES_STATUS_RE = /Spaces (?:app )?API (\d{3})\b/i;
const HTTP_STATUS_RE = /\bHTTP (\d{3})\b/;
const NETWORK_RE =
  /Spaces (?:app )?API network error|timed? ?out|timeout|ETIMEDOUT|ECONNRESET|ECONNREFUSED|EAI_AGAIN|fetch failed|socket hang up|unreachable/i;
const CONNECTION_RE =
  /invalid_grant|unauthorized_client|token (?:has )?(?:expired|been revoked)|refresh token|no connection for user|reauth|re-auth/i;
const CONVERSATION_NOT_FOUND_RE = /conversation not found/i;

/** Pull a numeric HTTP status off an error, if any layer recorded one. */
export function extractErrorStatus(err: unknown): number | undefined {
  if (err && typeof err === "object") {
    const status = (err as { status?: unknown }).status;
    if (typeof status === "number" && Number.isFinite(status)) return status;
    const httpStatus = (err as { httpStatus?: unknown }).httpStatus;
    if (typeof httpStatus === "number" && Number.isFinite(httpStatus)) return httpStatus;
  }
  const msg = errMsg(err);
  const m = SPACES_STATUS_RE.exec(msg) ?? HTTP_STATUS_RE.exec(msg);
  return m ? Number(m[1]) : undefined;
}

/**
 * Best-effort: pull the human message out of an upstream body such as
 * `Spaces API 403: {"error":"Permission denied"}`. Returns undefined when the
 * body is not JSON or carries nothing readable.
 */
export function extractUpstreamMessage(err: unknown): string | undefined {
  const msg = errMsg(err);
  const brace = msg.indexOf("{");
  if (brace < 0) return undefined;
  try {
    const body = JSON.parse(msg.slice(brace)) as Record<string, unknown>;
    for (const key of ["message", "error", "detail"] as const) {
      const v = body[key];
      if (typeof v === "string" && v.trim()) return v.trim();
      if (v && typeof v === "object" && typeof (v as { message?: unknown }).message === "string") {
        return ((v as { message: string }).message).trim();
      }
    }
  } catch {
    // Truncated or non-JSON body — not user-facing material.
  }
  return undefined;
}

/** Which kind of resource the tool writes to — drives the copy for 403/404. */
function resourceNoun(tool: string): string | undefined {
  const t = tool.toLowerCase();
  if (t.includes("canvas")) return "canvas";
  if (t.includes("ticket")) return "ticket";
  if (t.includes("message") || t.includes("chat")) return "conversation";
  if (t.includes("channel")) return "channel";
  if (t.includes("automation") || t.includes("workflow")) return "automation";
  if (t.includes("artifact")) return "document";
  return undefined;
}

function isReadable(upstream: string | undefined): upstream is string {
  return !!upstream && upstream.length <= 200 && !upstream.includes("{") && !/^(?:internal server error|error)$/i.test(upstream);
}

function userMessageFor(code: FlowActionErrorCode, tool: string, upstream: string | undefined, raw: string): string {
  const noun = resourceNoun(tool);
  switch (code) {
    case "PERMISSION_DENIED":
      return noun
        ? `You don't have edit access to this ${noun}. Ask its owner to give you edit access, then try again.`
        : FLOW_ACTION_ERROR_DEFAULT_MESSAGES.PERMISSION_DENIED;
    case "NOT_FOUND":
      if (CONVERSATION_NOT_FOUND_RE.test(raw) || noun === "conversation") {
        return "The target conversation no longer exists. Re-run the agent to create a new approval.";
      }
      return noun ? `This ${noun} no longer exists or was moved.` : FLOW_ACTION_ERROR_DEFAULT_MESSAGES.NOT_FOUND;
    case "INVALID_INPUT":
      return isReadable(upstream) ? `The change was rejected: ${upstream}` : FLOW_ACTION_ERROR_DEFAULT_MESSAGES.INVALID_INPUT;
    case "CONFLICT":
      return isReadable(upstream) ? `${upstream}. Refresh and try again.` : FLOW_ACTION_ERROR_DEFAULT_MESSAGES.CONFLICT;
    default:
      return FLOW_ACTION_ERROR_DEFAULT_MESSAGES[code];
  }
}

/** Build a typed error response for a code the caller already knows. */
export function flowActionError(code: FlowActionErrorCode, message?: string): FlowActionErrorResponse {
  return {
    type: "error",
    code,
    message: message ?? FLOW_ACTION_ERROR_DEFAULT_MESSAGES[code],
    retryable: isRetryableFlowActionError(code),
  };
}

/** Classify a thrown / returned tool failure into a typed, user-readable error. */
export function classifyToolError(err: unknown, ctx: ClassifyToolErrorContext): FlowActionErrorResponse {
  const raw = errMsg(err);
  const status = ctx.status ?? extractErrorStatus(err);
  let code: FlowActionErrorCode;
  if (status !== undefined && status !== 0) {
    code = flowActionErrorCodeFromStatus(status);
  } else if (CONVERSATION_NOT_FOUND_RE.test(raw)) {
    code = "NOT_FOUND";
  } else if (CONNECTION_RE.test(raw)) {
    code = "CONNECTION_REQUIRED";
  } else if (status === 0 || NETWORK_RE.test(raw)) {
    code = "UPSTREAM_UNAVAILABLE";
  } else {
    code = "INTERNAL";
  }
  return flowActionError(code, userMessageFor(code, ctx.tool, extractUpstreamMessage(err), raw));
}
