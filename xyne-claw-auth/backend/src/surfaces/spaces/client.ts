/**
 * HTTP client for the Spaces app API — every claw-auth -> Spaces call rides
 * these helpers (JSON, multipart, GET) with a one-shot 5xx retry. App tokens
 * are stored AES-GCM encrypted on the agent row; decryptStoredField unpacks
 * the `ciphertext:iv:authTag` wire format.
 * Extracted from routes/webhook.ts (2026-07-22 refactor session 1.4).
 */
import { CONFIG } from "../../config.js";
import { decrypt } from "../../crypto.js";
import { createLogger } from "../../logger.js";

const log = createLogger("spaces-client");

export async function withSpaces5xxRetry<T>(label: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
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
      throw new Error(`Spaces app API ${res.status}: ${text.slice(0, 500)}`);
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
    throw new Error(`Spaces app API ${res.status}: ${text.slice(0, 500)}`);
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
      throw new Error(`Spaces app API ${res.status}: ${text.slice(0, 500)}`);
    }

    return res.json();
  });
}


export function decryptStoredField(stored: string): string {
  const [ciphertext, iv, authTag] = stored.split(":");
  if (!ciphertext || !iv || !authTag) throw new Error("Invalid encrypted field format");
  return decrypt(ciphertext, iv, authTag, CONFIG.encryptionKey);
}
