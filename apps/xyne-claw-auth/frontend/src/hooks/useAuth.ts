import { useState, useEffect, useCallback } from "react";
import { getMe, getLoginUrl, getClawSessionIdentity } from "../lib/api";
import { frontendConfig } from "../lib/config";
import type { User } from "../lib/types";

type AuthState =
  | { status: "loading" }
  | {
      status: "authenticated";
      /** `user.id` is deliberately the canonical Claw id for Claw API calls. */
      user: User;
      /** Raw, workspace-scoped Spaces identity. Do not use in Claw URLs. */
      spacesUserId: string;
      spacesWorkspaceId?: string;
    }
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
 * AND a 10-min HttpOnly `google_access_token` cookie holding pending Google auth.
 * To complete login we must POST workspaceId to /api/auth/login-workspace, which
 * exchanges the pending cookie for a real `xyne_ws_<id>_token` session cookie.
 *
 * Without this step, /api/auth/validate keeps returning 401 because no session
 * row exists yet (we saw "No workspace session cookie present" in prod logs).
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
        const spacesUser = await getMe();
        const clawIdentity = await getClawSessionIdentity();
        // Keep display/profile data from Spaces, but make the id used throughout
        // this SPA the canonical Claw id. Every component passes `user.id` into
        // Claw API paths, so this prevents raw workspace-user ids from leaking
        // into per-user URLs and creating duplicate credential/config rows.
        setState({
          status: "authenticated",
          user: { ...spacesUser, id: clawIdentity.userId },
          spacesUserId: clawIdentity.spacesUserId ?? spacesUser.id,
          ...(clawIdentity.spacesWorkspaceId ? { spacesWorkspaceId: clawIdentity.spacesWorkspaceId } : {}),
        });
      } catch {
        setState({ status: "unauthenticated" });
      }
    })();
  }, []);

  const login = useCallback(() => {
    window.location.href = getLoginUrl();
  }, []);

  const logout = useCallback(() => {
    document.cookie = "google_access_token=; Max-Age=0; path=/";
    document.cookie = "user_session_id=; Max-Age=0; path=/";
    setState({ status: "unauthenticated" });
  }, []);

  return { ...state, login, logout };
}
