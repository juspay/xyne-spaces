/**
 * HTTP client for the Spaces app API — every claw-auth -> Spaces call rides
 * these helpers (JSON, multipart, GET) with a one-shot 5xx retry. App tokens
 * are stored AES-GCM encrypted on the agent row; decryptStoredField unpacks
 * the `ciphertext:iv:authTag` wire format.
 * Extracted from routes/webhook.ts (2026-07-22 refactor session 1.4).
 */
import { CONFIG } from "../../config.js";
import { errMsg } from "../../lib/errors.js";
import { decrypt } from "../../crypto.js";
import { createLogger } from "../../logger.js";
import { SpacesApiError, isFlowSchemaRejection } from "../../mcp/servers/xyne-spaces-client.js";

// Re-export so callers (webhook.ts) can branch on `err.status` / detect a
// flow-schema rejection from the same module they import the fetch helpers.
export { SpacesApiError, isFlowSchemaRejection };

const log = createLogger("spaces-client");

export async function withSpaces5xxRetry<T>(label: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    const msg = errMsg(err);
    const status = /^Spaces app API (\d{3})/.exec(msg)?.[1];
    if (!status || Number(status) < 500) throw err;
    log.warn(`[spaces-retry] ${label} got ${status} — retrying once after 2s`);
    await new Promise((r) => setTimeout(r, 2000));
    return await fn();
  }
}

export async function spacesAppFetchMultipart(path: string, form: FormData, appToken?: string): Promise<unknown> {
  const url = `${CONFIG.spacesInternalUrl}/api/apps${path}`;
  const token = appToken ?? "";
  if (!token) throw new Error("No app token provided");

  return withSpaces5xxRetry(`POST ${path} (multipart)`, async () => {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        // Do NOT set Content-Type — let fetch set it with the multipart boundary
        Authorization: `Bearer ${token}`,
      },
      body: form,
      signal: AbortSignal.timeout(60_000),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new SpacesApiError(res.status, `Spaces app API ${res.status}: ${text.slice(0, 500)}`);
    }

    return res.json();
  });
}

export async function spacesAppFetchGet(path: string, appToken?: string): Promise<unknown> {
  const url = `${CONFIG.spacesInternalUrl}/api/apps${path}`;
  const token = appToken ?? "";
  if (!token) throw new Error("No app token provided");
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new SpacesApiError(res.status, `Spaces app API ${res.status}: ${text.slice(0, 500)}`);
  }
  return res.json();
}

export async function spacesAppFetch(path: string, body: Record<string, unknown>, appToken?: string): Promise<unknown> {
  const url = `${CONFIG.spacesInternalUrl}/api/apps${path}`;
  const token = appToken ?? "";
  if (!token) throw new Error("No app token provided");

  return withSpaces5xxRetry(`POST ${path}`, async () => {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new SpacesApiError(res.status, `Spaces app API ${res.status}: ${text.slice(0, 500)}`);
    }

    return res.json();
  });
}


/**
 * Light the dashboard's "agent is working" progress pill IMMEDIATELY, before the
 * agent's first tool call. The normal mention path posts this at dispatch time
 * (webhook.ts, right after /internal/run returns). DIRECT /internal/run dispatches
 * — plan-mode Turn 2 (manual approval in flow-action.ts AND trivial auto-run in
 * webhook.ts) — must post it too; otherwise the pill only appears when the FIRST
 * progress tick arrives, i.e. after the LLM's first response, which can be minutes
 * on a slow model. Fire-and-forget: never block or fail the dispatch on it. The
 * pill self-clears via the /webhook/result "done" signal (and a client stale-sweep).
 */
export async function emitAgentWorkingSignal(opts: {
  conversationId?: string | undefined;
  channelId?: string | undefined;
  agentSlug?: string | undefined;
  spacesAppUserId?: string | undefined;
  appToken?: string | undefined;
  toolLabel?: string;
}): Promise<void> {
  if (!opts.appToken) return;
  try {
    await spacesAppFetch(
      "/chat/agentProgress",
      {
        conversationId: opts.conversationId,
        channelId: opts.channelId,
        agentSlug: opts.agentSlug,
        userId: opts.spacesAppUserId,
        toolLabel: opts.toolLabel ?? "Working on it...",
        status: "working",
      },
      opts.appToken,
    );
  } catch {
    // Best-effort — the pill will still light on the first real progress tick.
  }
}

export function decryptStoredField(stored: string): string {
  const [ciphertext, iv, authTag] = stored.split(":");
  if (!ciphertext || !iv || !authTag) throw new Error("Invalid encrypted field format");
  return decrypt(ciphertext, iv, authTag, CONFIG.encryptionKey);
}
