/**
 * Microsoft Graph API fetch helper.
 * OAuth flow and token management are handled by xyne-claw-auth.
 * This module only provides the authenticated fetch wrapper.
 */

/** Make an authenticated Microsoft Graph API call. Throws on non-2xx. */
export async function microsoftFetch(
  url: string,
  accessToken: string,
  init?: RequestInit,
): Promise<unknown> {
  const response = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      ...(init?.headers as Record<string, string> | undefined),
    },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Microsoft Graph API ${response.status}: ${text}`);
  }

  // 204 No Content (e.g. DELETE) has no body
  if (response.status === 204) return undefined;

  return response.json();
}
