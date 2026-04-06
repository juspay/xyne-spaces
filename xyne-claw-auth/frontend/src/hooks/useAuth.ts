import { useState, useEffect, useCallback } from "react";
import { getMe, getLoginUrl, upsertUser } from "../lib/api";
import type { User } from "../lib/types";

type AuthState =
  | { status: "loading" }
  | { status: "authenticated"; user: User }
  | { status: "unauthenticated" };

export function useAuth() {
  const [state, setState] = useState<AuthState>({ status: "loading" });

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("success") === "true") {
      window.history.replaceState(null, "", window.location.pathname);
    }
    getMe()
      .then(async (user) => {
        // Ensure user exists in auth DB before any connection/gateway operations
        await upsertUser(user).catch(() => {});
        setState({ status: "authenticated", user });
      })
      .catch(() => setState({ status: "unauthenticated" }));
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
