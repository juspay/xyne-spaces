// backend/src/utils/appUrls.ts
//
// Single source of truth for building shareable/deep-link URLs that point at
// the Xyne Spaces frontend.
//
// WHY THIS EXISTS
// ----------------
// Shareable links (canvas, ticket, message, channel, support, automation,
// Slack notifications, PR build-status targets, …) must resolve to the correct
// host for the environment they are generated in — `http://localhost:5173`
// locally, the sandbox domain in sandbox, and `https://spaces.xyne.juspay.net`
// in production. The canonical base is the env var `FRONTEND_URL`
// (`config.frontendUrl`); DO NOT hardcode the production domain at call sites.
//
// Set FRONTEND_URL per environment:
//   local    → http://localhost:5173      (Joi default)
//   sandbox  → https://spaces.sandbox.xyne.juspay.net
//   prod     → https://spaces.xyne.juspay.net
//
// NOTE: This module is for URL GENERATION only. It is intentionally separate
// from the multi-host *detection* allowlists (TRUSTED_ORIGINS in
// `@xyne/shared`, INTERNAL_HOSTS in `urlUtils.ts`) — those must continue to
// list every host we accept inbound and must NOT be collapsed to one origin.

import { config } from '@/config/env';

/**
 * Canonical frontend base URL for the current environment, with any trailing
 * slash stripped. Driven entirely by `FRONTEND_URL`; never hardcoded.
 */
export function appBaseUrl(): string {
  return (config.frontendUrl ?? '').replace(/\/+$/, '');
}

/**
 * Join the canonical base with an app-relative path, preserving the caller's
 * path, query, and hash exactly. Pass the same path/query/hash the call site
 * already produced — this only swaps the hardcoded host for the env base.
 */
export function appUrl(path: string): string {
  if (!path) return appBaseUrl();
  const suffix = path.startsWith('/') ? path : `/${path}`;
  return `${appBaseUrl()}${suffix}`;
}

/** Optional `/{workspaceId}` segment used by workspace-scoped routes. */
function wsPrefix(workspaceId?: string): string {
  return workspaceId ? `/${encodeURIComponent(workspaceId)}` : '';
}

// ---------------------------------------------------------------------------
// Typed builders. Each mirrors the exact route shape already used in the app
// so migrating a call site is a pure host swap — no path/query/hash changes.
// ---------------------------------------------------------------------------

/** Shareable canvas link: `/{ws}/chat/canvas/{canvasId}` (ws optional). */
export function canvasUrl(canvasId: string, workspaceId?: string): string {
  return appUrl(`${wsPrefix(workspaceId)}/chat/canvas/${canvasId}`);
}

/** Directory channel link: `/{ws}/chat/dir/{channelId}`. */
export function dirChannelUrl(channelId: string, workspaceId?: string): string {
  return appUrl(`${wsPrefix(workspaceId)}/chat/dir/${channelId}`);
}

/** Generic channel link: `/{ws}/chat/{channelId}`. */
export function channelUrl(channelId: string, workspaceId?: string): string {
  return appUrl(`${wsPrefix(workspaceId)}/chat/${channelId}`);
}

/** Conversation deep-link within a channel: `/{ws}/chat/{channelId}/{conversationId}`. */
export function conversationUrl(
  channelId: string,
  conversationId: string,
  workspaceId?: string,
): string {
  return appUrl(`${wsPrefix(workspaceId)}/chat/${channelId}/${conversationId}`);
}
