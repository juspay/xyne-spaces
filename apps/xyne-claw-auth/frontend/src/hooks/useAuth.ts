import { useState, useEffect, useCallback } from "react";
import { getMe, getLoginUrl, upsertUser } from "../lib/api";
import { frontendConfig } from "../lib/config";
import type { User } from "../lib/types";

type AuthState =
  | { status: "loading" }
  | { status: "authenticated"; user: User }
  | { status: "unauthenticated" };

const AUTH_BASE_URL = `${frontendConfig.spacesAuthBaseUrl}/api/auth`;

/**
 * Gate the authV2 two-step login handshake (Google callback redirect with
 * `?success=true&workspaces=[...]` → POST /api/auth/login-workspace) behind
 * a hardcoded constant. Set `true` only when the Spaces backend in your
 * target environment ships `/api/auth/login-workspace`. Flip on deploy.
 */
const USE_AUTH_V2 = true;

/**
 * authV2 callback redirects here with `?success=true&email=...&workspaces=[...]`
 * AND a 10-min HttpOnly pending-identity cookie holding the pending Google
 * identity. To complete login we must POST workspaceId to
 * /api/auth/login-workspace, which exchanges the pending cookie for the real
 * session: the httpOnly session cookie `xs`, the per-workspace JWT cookie
 * `xw_<workspaceId>`, and the `xyne_last_workspace` hint. The workspace is
 * still a per-request claim (`x-workspace-id` / the hint cookie).
 *
 * Without this step, /api/auth/me keeps returning 401 because no session row
 * exists yet.
 */
async function completeAuthV2HandshakeIfNeeded(): Promise<void> {
  if (!USE_AUTH_V2) return;

  const params = new URLSearchParams(window.location.search);
  if (params.get("success") !== "true") return;

  const workspacesRaw = params.get("workspaces");
  if (!workspacesRaw) return;

  let workspaces: Array<{ workspaceId: string }> = [];
  try {
    workspaces = JSON.parse(workspacesRaw);
  } catch {
    return;
  }
  if (workspaces.length === 0) return;

  // Auto-pick the first workspace. (Multi-workspace selection UI lives in the
  // Spaces dashboard; for the claw-auth SPA we just use whichever the user has.)
  const workspaceId = workspaces[0]?.workspaceId;
  if (!workspaceId) return;

  await fetch(`${AUTH_BASE_URL}/login-workspace`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ workspaceId }),
  });
}

export function useAuth() {
  const [state, setState] = useState<AuthState>({ status: "loading" });

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const justLoggedIn = USE_AUTH_V2 && params.get("success") === "true";

    (async () => {
      if (justLoggedIn) {
        await completeAuthV2HandshakeIfNeeded().catch(() => {});
        // Strip auth params from URL so a refresh doesn't re-trigger the handshake.
        window.history.replaceState(null, "", window.location.pathname);
      }

      try {
        const user = await getMe();
        await upsertUser(user).catch(() => {});
        setState({ status: "authenticated", user });
      } catch {
        setState({ status: "unauthenticated" });
      }
    })();
  }, []);

  const login = useCallback(() => {
    window.location.href = getLoginUrl();
  }, []);

  const logout = useCallback(() => {
    // The httpOnly session cookie `xs` (and the `xw_*` workspace cookies)
    // cannot be cleared from `document.cookie`. Spaces' logout revokes the
    // session row and clears every auth cookie server-side; the local state
    // flips regardless so the UI never waits on the network.
    fetch(`${AUTH_BASE_URL}/logout`, { method: "POST", credentials: "include" }).catch(() => {});
    setState({ status: "unauthenticated" });
  }, []);

  return { ...state, login, logout };
}
