/**
 * Generic live OAuth-token route: `GET /:userId/oauth/:provider/token`.
 *
 * Replaces the 13 byte-for-byte-identical per-connector token handlers. Each
 * connector file now exports only an `OAuthTokenProvider` descriptor (its
 * refresh + optional responseData); this module registers them all behind one
 * route whose security/persistence skeleton lives in lib/oauth-token-endpoint.ts.
 *
 * URLs are unchanged (`/users/:userId/oauth/google/token`, etc.) so every
 * existing caller (xyne-claw run.ts, the MCP runner) keeps working verbatim.
 */

import { buildOAuthTokenRouter, type OAuthTokenProvider } from "../lib/oauth-token-endpoint.js";
import { isOAuthServer } from "../lib/oauth-server-types.js";
import { googleOAuthProvider } from "./google-oauth.js";
import { microsoftOAuthProvider } from "./microsoft-oauth.js";
import { docusignOAuthProvider } from "./docusign-oauth.js";
import { egnyteOAuthProvider } from "./egnyte-oauth.js";
import { miroOAuthProvider } from "./miro-oauth.js";
import { calendlyOAuthProvider } from "./calendly-oauth.js";
import { jotformOAuthProvider } from "./jotform-oauth.js";
import { wixOAuthProvider } from "./wix-oauth.js";
import { webflowOAuthProvider } from "./webflow-oauth.js";
import { mailerliteOAuthProvider } from "./mailerlite-oauth.js";
import { attioOAuthProvider } from "./attio-oauth.js";
import { honeycombOAuthProvider } from "./honeycomb-oauth.js";
import { customerioOAuthProvider } from "./customerio-oauth.js";

const ALL_OAUTH_PROVIDERS: OAuthTokenProvider[] = [
  googleOAuthProvider,
  microsoftOAuthProvider,
  docusignOAuthProvider,
  egnyteOAuthProvider,
  miroOAuthProvider,
  calendlyOAuthProvider,
  jotformOAuthProvider,
  wixOAuthProvider,
  webflowOAuthProvider,
  mailerliteOAuthProvider,
  attioOAuthProvider,
  honeycombOAuthProvider,
  customerioOAuthProvider,
];

const PROVIDERS_BY_TYPE = new Map(ALL_OAUTH_PROVIDERS.map((p) => [p.serverType, p]));

/**
 * Look up an OAuth provider descriptor by its mcpServer.type. Used by the MCP
 * credential-loader to refresh google/microsoft access tokens through the same
 * logic that backs the `/oauth/:provider/token` route.
 */
export function getOAuthProvider(serverType: string): OAuthTokenProvider | undefined {
  return PROVIDERS_BY_TYPE.get(serverType);
}

/**
 * Complete "is this connector OAuth?" predicate — the single source of truth
 * the API/UI should use instead of the static {@link isOAuthServer} set alone.
 *
 * A connector authenticates via OAuth if EITHER:
 *   1. it has a registered {@link OAuthTokenProvider} (all self-serve OAuth
 *      connectors: google, microsoft, calendly, docusign, … — the authoritative
 *      13-entry registry above), OR
 *   2. the DB declares it via the built-in set / `connectorMeta.authMethod`
 *      (kept for admin-registered custom OAuth connectors that ship no provider).
 *
 * `isOAuthServer` alone only recognised google/microsoft, so every self-serve
 * OAuth connector was mislabelled `oauth: false` by the /servers route.
 */
export function isOAuthConnector(serverType: string, connectorMeta?: unknown, isOauth?: boolean): boolean {
  return getOAuthProvider(serverType) !== undefined || isOAuthServer(serverType, connectorMeta, isOauth);
}

export const oauthTokenRouter = buildOAuthTokenRouter(ALL_OAUTH_PROVIDERS);
