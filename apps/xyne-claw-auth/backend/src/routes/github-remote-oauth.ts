import { createClassicOAuthProvider } from "../lib/classic-oauth-provider.js";

// GitHub has no dynamic client registration, so this uses a GitHub App (or
// OAuth App) registered by us. Create it with the callback URL
// `<AUTH_SERVICE_URL>/claw/api/v1/github-remote/callback` and set
// GITHUB_OAUTH_CLIENT_ID / GITHUB_OAUTH_CLIENT_SECRET. Prefer a GitHub App with
// "Expire user authorization tokens" on: tokens last 8h and refresh. An OAuth App
// issues non-expiring tokens, which are stored as valid for ten years.
// `scope` only applies to OAuth Apps; GitHub Apps take their permissions from the app.
const { router, callbackRouter, provider, ensureServer } = createClassicOAuthProvider({
  type: "github-remote",
  label: "GitHub",
  clientIdEnv: "GITHUB_OAUTH_CLIENT_ID",
  clientSecretEnv: "GITHUB_OAUTH_CLIENT_SECRET",
  authUrl: "https://github.com/login/oauth/authorize",
  tokenUrl: "https://github.com/login/oauth/access_token",
  scope: process.env["GITHUB_OAUTH_SCOPES"] ?? "repo read:org read:user user:email",
  rotatesRefreshToken: true,
  server: {
    name: "GitHub (OAuth)",
    url: "https://api.githubcopilot.com/mcp/",
    description: "GitHub integration over OAuth — repositories, issues, pull requests, code search and Actions, as the connecting user.",
  },
});

export const githubRemoteOAuthRouter = router;
export const githubRemoteCallbackRouter = callbackRouter;
export const githubRemoteOAuthProvider = provider;
export const githubRemoteEnsureServer = ensureServer;
