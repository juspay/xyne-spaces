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

export function surfaceResultText(result: SurfaceResult): string {
  if (result.image?.data) {
    return `${result.content ?? ""}\n\ndata:${result.image.mimeType};base64,${result.image.data}`;
  }
  return result.content ?? "";
}
