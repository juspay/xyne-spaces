/**
 * Shared helpers for calling the Xyne Spaces App API.
 * Used by webhook.ts and scheduled-jobs.ts.
 */

import { CONFIG } from "../config.js";
import { SpacesApiError } from "../mcp/servers/xyne-spaces-client.js";

// Re-export so callers of these helpers can branch on `err.status` without
// reaching across into the client module.
export { SpacesApiError };

export async function spacesAppFetch(
  path: string,
  body: Record<string, unknown>,
  appToken: string,
): Promise<unknown> {
  const url = `${CONFIG.spacesInternalUrl}/api/apps${path}`;
  if (!appToken) throw new Error("No app token provided");
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${appToken}`,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new SpacesApiError(res.status, `Spaces app API ${res.status}: ${text.slice(0, 500)}`);
  }

  return res.json();
}

export async function spacesAppFetchGet(
  path: string,
  appToken: string,
): Promise<unknown> {
  const url = `${CONFIG.spacesInternalUrl}/api/apps${path}`;
  if (!appToken) throw new Error("No app token provided");
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${appToken}` },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new SpacesApiError(res.status, `Spaces app API ${res.status}: ${text.slice(0, 500)}`);
  }
  return res.json();
}

export async function spacesAppFetchMultipart(
  path: string,
  form: FormData,
  appToken: string,
): Promise<unknown> {
  const url = `${CONFIG.spacesInternalUrl}/api/apps${path}`;
  if (!appToken) throw new Error("No app token provided");
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${appToken}`,
    },
    body: form,
    signal: AbortSignal.timeout(60_000),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new SpacesApiError(res.status, `Spaces app API ${res.status}: ${text.slice(0, 500)}`);
  }

  return res.json();
}
