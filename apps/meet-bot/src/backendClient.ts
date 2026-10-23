import { log } from "./log.js";
import type { LivekitSession, SessionBackend, StatusEvent } from "./session.js";
import type { Speaker } from "./speakerRouter.js";

const ATTEMPTS = 3;

/**
 * Talks to the backend about one session, at the per-session callback URL the
 * backend gave when it started the session (…/api/meet-bot/sessions/<callId>).
 */
export function backendClient(
  callbackUrl: string,
  apiKey: string,
  overrides: { backendUrl?: string | undefined; livekitUrl?: string | undefined } = {},
): SessionBackend {
  const base = withOrigin(callbackUrl, overrides.backendUrl).replace(/\/+$/, "");

  async function post(path: string, body: unknown): Promise<Response> {
    for (let attempt = 1; ; attempt++) {
      try {
        const response = await fetch(`${base}${path}`, {
          method: "POST",
          headers: { "content-type": "application/json", "x-api-key": apiKey },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(20_000),
        });
        // 4xx won't get better on retry.
        if (response.ok || response.status < 500) return response;
        throw new Error(`HTTP ${response.status}`);
      } catch (error) {
        if (attempt >= ATTEMPTS) throw error;
        await new Promise((resolve) => setTimeout(resolve, attempt * 1_000));
      }
    }
  }

  return {
    async reportStatus(event: StatusEvent): Promise<void> {
      const response = await post("/status", event);
      if (!response.ok) log.warn("status_report_rejected", { sessionId: event.sessionId, status: response.status });
    },
    async startLivekit(speaker?: Speaker): Promise<LivekitSession> {
      const response = await post("/livekit", speaker ? { speaker } : {});
      const body = (await response.json().catch(() => ({}))) as Partial<LivekitSession> & { error?: string };
      if (!response.ok || !body.livekitUrl || !body.token) {
        throw new Error(`Backend refused a LiveKit session (HTTP ${response.status}${body.error ? `: ${body.error}` : ""})`);
      }
      return { livekitUrl: overrides.livekitUrl ?? body.livekitUrl, token: body.token };
    },
  };
}

/** Swaps the scheme, host and port of `url` for those of `origin`, keeping the path. */
export function withOrigin(url: string, origin: string | undefined): string {
  if (!origin) return url;
  const target = new URL(url);
  const replacement = new URL(origin);
  target.protocol = replacement.protocol;
  target.host = replacement.host;
  return target.toString();
}
