const AUTH_FAILURE_PHRASES = [
  "unauthorized",
  "unauthenticated",
  "not authorized",
  "not authed",
  "forbidden",
  "authentication failed",
  "authentication error",
  "authentication required",
  "auth error",
  "auth failed",
  "invalid auth",
  "invalid api key",
  "invalid token",
  "invalid access token",
  "invalid key",
  "invalid credentials",
  "invalid grant",
  "bad credentials",
  "token expired",
  "token revoked",
  "expired key",
  "account inactive",
  "access denied",
  "permission denied",
  "401",
  "403",
];

const TRANSIENT_PHRASES = [
  "rate-limited",
  "rate limited",
  "rate_limit",
  "too many requests",
  "429",
  "try again later",
  "retry later",
  "temporarily unavailable",
  "service unavailable",
];

const PARAM_PHRASES = [
  "must be provided",
  "is required",
  "required parameter",
  "missing required",
  "invalid params",
  "invalid_params",
  "invalid argument",
  "invalid arguments",
  "unknown argument",
];

export type ToolResultVerdictKind = "auth" | "transient" | "params" | "unknown";

export interface ToolResultVerdict {
  kind: ToolResultVerdictKind;
  message: string;
}

function errorMessageFrom(text: string): string | null {
  try {
    const parsed: unknown = JSON.parse(text);
    const record = Array.isArray(parsed) ? undefined : (parsed as Record<string, unknown> | null);
    const raw = record?.["error"] ?? record?.["errors"];
    if (raw === undefined || raw === null || raw === false) return null;
    if (typeof raw === "string") return raw;
    const nested = (raw as Record<string, unknown>)?.["message"];
    if (typeof nested === "string") return nested;
    const first = Array.isArray(raw) ? (raw[0] as Record<string, unknown> | undefined) : undefined;
    if (typeof first?.["message"] === "string") return first["message"] as string;
    return JSON.stringify(raw);
  } catch {
    return null;
  }
}

export function classifyToolResult(content: string): ToolResultVerdict | null {
  const text = content.trim();
  if (!text) return null;

  const extracted = errorMessageFrom(text);
  const candidate = extracted ?? (text.length <= 300 ? text : "");
  if (!candidate) return null;

  const message = candidate.replace(/\s+/g, " ").slice(0, 200);
  const lower = message.toLowerCase().replace(/[_-]+/g, " ");

  if (PARAM_PHRASES.some((phrase) => lower.includes(phrase))) return { kind: "params", message };
  if (TRANSIENT_PHRASES.some((phrase) => lower.includes(phrase))) return { kind: "transient", message };
  if (AUTH_FAILURE_PHRASES.some((phrase) => lower.includes(phrase))) return { kind: "auth", message };
  return extracted ? { kind: "unknown", message } : null;
}

export function verdictBlocksConnection(verdict: ToolResultVerdict | null): boolean {
  if (!verdict) return false;
  return verdict.kind !== "params";
}
