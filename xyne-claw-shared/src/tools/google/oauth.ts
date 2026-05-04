/**
 * Google API fetch helper.
 * OAuth flow and token management are handled by xyne-claw-auth.
 * This module only provides the authenticated fetch wrapper.
 */

/** Make an authenticated Google API call. Throws on non-2xx. */
export async function googleFetch(
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
    throw new Error(`Google API ${response.status}: ${text}`);
  }

  // 204 No Content (e.g. DELETE) has no body
  if (response.status === 204) return undefined;

  return response.json();
}

/**
 * Refresh a Google OAuth access token using a refresh token.
 * Used by xyne-claw-auth's Google OAuth adapter.
 */
export async function refreshGoogleToken(
  refreshToken: string,
  clientId: string,
  clientSecret: string,
): Promise<{ accessToken: string; expiresIn: number }> {
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Google token refresh failed: ${response.status} ${text}`);
  }

  const tokens = (await response.json()) as {
    access_token: string;
    expires_in: number;
  };

  return {
    accessToken: tokens.access_token,
    expiresIn: tokens.expires_in,
  };
}
