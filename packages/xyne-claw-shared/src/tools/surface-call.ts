import type { ToolExecutionContext } from "./types.js";
import { clawAuthUrl } from "./claw-auth-url.js";

const SURFACE_TIMEOUT_MS = 20_000;

export interface SurfaceResult {
  ok?: boolean;
  content?: string;
  image?: { data: string; mimeType: string };
  unavailable?: boolean;
}

export type SurfaceOutcome = { result: SurfaceResult } | { error: string };

export async function requestSurfaceCall(
  toolName: string,
  params: Record<string, unknown>,
  context: ToolExecutionContext | undefined,
): Promise<SurfaceOutcome> {
  const userId = context?.meta?.["userId"] ?? "";
  if (!userId) {
    return { error: "Error: this run has no user, so there is no Xyne window to reach." };
  }
  try {
    const res = await fetch(`${clawAuthUrl()}/claw/api/v1/internal/surface/call`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(context?.s2sKey ? { "x-s2s-key": context.s2sKey } : {}),
      },
      body: JSON.stringify({
        userId,
        sessionId: context?.sessionId ?? null,
        toolName,
        params,
      }),
      signal: AbortSignal.timeout(SURFACE_TIMEOUT_MS),
    });
    if (!res.ok) {
      return { error: `Error: the Xyne app could not be reached (status ${res.status}).` };
    }
    const body = (await res.json()) as { data?: SurfaceResult };
    if (!body.data) return { error: "Error: the Xyne app returned nothing." };
    return { result: body.data };
  } catch (err) {
    return { error: `Error: reaching the Xyne app failed — ${err instanceof Error ? err.message : String(err)}` };
  }
}

const IMAGE_EXTENSIONS: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };

export function surfaceResultText(result: SurfaceResult, toolName = "screenshot"): string {
  const image = result.image;
  if (image?.data && /^[A-Za-z0-9+/=]+$/.test(image.data)) {
    const ext = IMAGE_EXTENSIONS[image.mimeType] ?? "png";
    const text = result.content ?? "";
    return `[ATTACHMENT:${toolName}.${ext}:${image.mimeType}]\n${image.data}${text ? `\n${text}` : ""}`;
  }
  return result.content ?? "";
}

const DESKTOP_PIN_MS = 6 * 60 * 60 * 1000;
const MAX_PINNED_RUNS = 5000;
const desktopRuns = new Map<string, number>();

function desktopPinned(sessionId: string): boolean {
  const at = desktopRuns.get(sessionId);
  if (at === undefined) return false;
  if (Date.now() - at <= DESKTOP_PIN_MS) return true;
  desktopRuns.delete(sessionId);
  return false;
}

function pinDesktop(sessionId: string): void {
  desktopRuns.delete(sessionId);
  desktopRuns.set(sessionId, Date.now());
  if (desktopRuns.size > MAX_PINNED_RUNS) {
    const oldest = desktopRuns.keys().next().value;
    if (oldest !== undefined) desktopRuns.delete(oldest);
  }
}

export async function callDesktopBrowser(
  toolName: string,
  params: Record<string, unknown>,
  context: ToolExecutionContext | undefined,
): Promise<string | null> {
  const sessionId = context?.sessionId ?? "";
  if (!sessionId || !context?.meta?.["userId"]) return null;
  const outcome = await requestSurfaceCall(toolName, params, context);
  if (!("error" in outcome) && !outcome.result.unavailable) {
    pinDesktop(sessionId);
    return surfaceResultText(outcome.result, toolName);
  }
  if (!desktopPinned(sessionId)) return null;
  const reason = ("error" in outcome ? outcome.error : (outcome.result.content ?? "")).replace(/^Error:\s*/, "").trim();
  return (
    `Error: ${toolName} could not reach the browser panel in the user's Xyne desktop app` +
    (reason ? ` (${reason})` : "") +
    ". This run is working in that browser, so the call was not moved to the sandbox browser. " +
    "Ask the user to keep this conversation open on the Xyne AI screen, then try again."
  );
}
