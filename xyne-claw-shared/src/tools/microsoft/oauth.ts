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

/**
 * Refresh a Microsoft OAuth access token using a refresh token.
 * Used by xyne-claw-auth's Microsoft OAuth adapter.
 */
export async function refreshMicrosoftToken(
  refreshToken: string,
  clientId: string,
  clientSecret: string,
  tenantId?: string,
): Promise<{ accessToken: string; refreshToken: string; expiresIn: number }> {
  const tid = tenantId ?? "common";
  const response = await fetch(`https://login.microsoftonline.com/${tid}/oauth2/v2.0/token`, {
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
    throw new Error(`Microsoft token refresh failed: ${response.status} ${text}`);
  }

  const tokens = (await response.json()) as {
    access_token: string;
    refresh_token: string;
    expires_in: number;
  };

  return {
    accessToken: tokens.access_token,
    // Microsoft rotates refresh tokens — always store the new one
    refreshToken: tokens.refresh_token,
    expiresIn: tokens.expires_in,
  };
}
