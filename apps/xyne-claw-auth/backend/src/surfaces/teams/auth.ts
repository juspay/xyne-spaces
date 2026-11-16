/**
 * Bot Framework authentication, both directions.
 *
 * Inbound (Bot Connector → us): every POST carries `Authorization: Bearer
 * <JWT>`. It is accepted only when
 *   - it is signed by a key from the Bot Connector's OpenID metadata (JWKS),
 *     and that key is endorsed for the activity's channel ("msteams"),
 *   - `iss` is https://api.botframework.com,
 *   - `aud` is this account's Microsoft App ID,
 *   - it is inside its validity window (5 minutes of clock skew allowed),
 *   - its `serviceUrl` claim equals the activity's `serviceUrl` — which is
 *     what makes the serviceUrl safe to send a bearer token to later.
 *
 * Outbound (us → Bot Connector): an Entra client-credentials token for the
 * App ID, scoped to the Bot Framework, cached until shortly before it expires.
 *
 * Both halves take their HTTP client as a parameter so tests run against fake
 * keys and a fake token endpoint; nothing here reaches Microsoft in a test.
 */
import { importJWK, jwtVerify, type JWK, type JWTPayload } from "jose";
import { fetch as undiciFetch } from "undici";
import { createLogger } from "../../logger.js";
import { errMsg } from "../../lib/errors.js";
import {
  BOTFRAMEWORK_ISSUER,
  BOTFRAMEWORK_OPENID_METADATA_URL,
  BOTFRAMEWORK_SCOPE,
  LOGIN_ORIGIN,
  MULTI_TENANT_AUTHORITY,
} from "./schema.js";

const log = createLogger("teams-auth");

/** The slice of fetch this module uses, so tests can hand in a fake. */
export type HttpFetch = (
  url: string,
  init?: { method?: string; headers?: Record<string, string>; body?: string },
) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

const defaultFetch: HttpFetch = (url, init) => undiciFetch(url, init);

/** Microsoft rolls signing keys; refresh at least daily, as its guidance asks. */
const KEYS_MAX_AGE_MS = 24 * 60 * 60 * 1000;
/** An unknown `kid` triggers a refetch, but not more often than this — a
 *  stream of forged tokens must not become a stream of requests to Microsoft. */
const KEYS_MIN_REFETCH_MS = 5 * 60 * 1000;
const CLOCK_TOLERANCE_S = 5 * 60;

interface BotFrameworkKey extends JWK {
  kid?: string;
  endorsements?: string[];
}

export interface BotFrameworkClaims extends JWTPayload {
  serviceUrl?: string;
}

export type InboundAuthResult = { ok: true; claims: BotFrameworkClaims } | { ok: false; reason: string };

export class BotFrameworkAuth {
  private keys: BotFrameworkKey[] = [];
  private fetchedAt = 0;
  private nextAttemptAt = 0;
  private inflight: Promise<void> | null = null;
  private readonly tokens = new Map<string, { token: string; expiresAt: number }>();
  private readonly tokenInflight = new Map<string, Promise<string>>();

  constructor(
    private readonly http: HttpFetch = defaultFetch,
    private readonly now: () => number = Date.now,
    private readonly metadataUrl: string = BOTFRAMEWORK_OPENID_METADATA_URL,
  ) {}

  // ── inbound ──

  async verifyInbound(input: {
    authorization: string | undefined;
    appId: string;
    channelId: string;
    serviceUrl: string;
  }): Promise<InboundAuthResult> {
    const header = input.authorization ?? "";
    if (!header.startsWith("Bearer ")) return { ok: false, reason: "missing bearer token" };
    const token = header.slice("Bearer ".length).trim();
    if (!token) return { ok: false, reason: "empty bearer token" };
    if (!input.appId) return { ok: false, reason: "no app id configured" };

    let claims: BotFrameworkClaims;
    try {
      const verified = await jwtVerify<BotFrameworkClaims>(
        token,
        async (protectedHeader) => {
          const key = await this.keyFor(protectedHeader.kid);
          if (!key) throw new Error(`unknown signing key ${protectedHeader.kid ?? "(no kid)"}`);
          // A key that is not endorsed for this channel may sign for some
          // other channel; it must not vouch for a Teams activity.
          if (!key.endorsements?.includes(input.channelId)) {
            throw new Error(`signing key not endorsed for channel ${input.channelId}`);
          }
          return importJWK(key, protectedHeader.alg ?? "RS256");
        },
        {
          issuer: BOTFRAMEWORK_ISSUER,
          audience: input.appId,
          algorithms: ["RS256"],
          clockTolerance: CLOCK_TOLERANCE_S,
          currentDate: new Date(this.now()),
          requiredClaims: ["exp"],
        },
      );
      claims = verified.payload;
    } catch (err) {
      return { ok: false, reason: errMsg(err) };
    }

    // The activity names where to send replies; the token must say the same,
    // or a valid token could be replayed with a serviceUrl of the sender's
    // choosing and we would hand our own bearer token to it.
    if (!claims.serviceUrl || !sameServiceUrl(claims.serviceUrl, input.serviceUrl)) {
      return { ok: false, reason: "serviceUrl claim does not match the activity" };
    }
    return { ok: true, claims };
  }

  private async keyFor(kid: string | undefined): Promise<BotFrameworkKey | undefined> {
    const find = () => this.keys.find((k) => k.kid === kid);
    const stale = this.now() - this.fetchedAt > KEYS_MAX_AGE_MS;
    // Refresh when the set is old or does not know this kid, but never more
    // often than KEYS_MIN_REFETCH_MS, whether the last attempt worked or not.
    if ((stale || !find()) && this.now() >= this.nextAttemptAt) await this.refreshKeys();
    return find();
  }

  private async refreshKeys(): Promise<void> {
    if (!this.inflight) {
      this.nextAttemptAt = this.now() + KEYS_MIN_REFETCH_MS;
      this.inflight = this.loadKeys().finally(() => {
        this.inflight = null;
      });
    }
    await this.inflight;
  }

  private async loadKeys(): Promise<void> {
    try {
      const metadata = (await getJson(this.http, this.metadataUrl)) as { jwks_uri?: unknown };
      const jwksUri = typeof metadata.jwks_uri === "string" ? metadata.jwks_uri : "";
      if (!jwksUri.startsWith("https://")) throw new Error("OpenID metadata has no https jwks_uri");
      const jwks = (await getJson(this.http, jwksUri)) as { keys?: unknown };
      const keys = Array.isArray(jwks.keys) ? (jwks.keys as BotFrameworkKey[]) : [];
      if (keys.length === 0) throw new Error("JWKS has no keys");
      this.keys = keys;
      this.fetchedAt = this.now();
    } catch (err) {
      // Keep the keys we had: a Microsoft hiccup must not reject every
      // message, and a key that was rolled out simply never matches.
      log.warn(`[teams-auth] signing key refresh failed: ${errMsg(err)}`);
    }
  }

  // ── outbound ──

  /** A bearer token for calls to the Bot Connector, cached per app. */
  async connectorToken(input: { appId: string; appPassword: string; tenantId?: string | undefined }): Promise<string> {
    const authority = input.tenantId || MULTI_TENANT_AUTHORITY;
    const cacheKey = `${authority}:${input.appId}`;
    const cached = this.tokens.get(cacheKey);
    if (cached && cached.expiresAt > this.now()) return cached.token;
    const pending = this.tokenInflight.get(cacheKey);
    if (pending) return pending;
    const request = this.fetchToken(authority, input.appId, input.appPassword)
      .then(({ token, expiresInS }) => {
        // Renew five minutes early so a token never expires mid-send.
        this.tokens.set(cacheKey, { token, expiresAt: this.now() + Math.max(60, expiresInS - 300) * 1000 });
        return token;
      })
      .finally(() => this.tokenInflight.delete(cacheKey));
    this.tokenInflight.set(cacheKey, request);
    return request;
  }

  /** Forget a token the Bot Connector refused, so the next send fetches anew. */
  dropToken(input: { appId: string; tenantId?: string | undefined }): void {
    this.tokens.delete(`${input.tenantId || MULTI_TENANT_AUTHORITY}:${input.appId}`);
  }

  private async fetchToken(authority: string, appId: string, appPassword: string): Promise<{ token: string; expiresInS: number }> {
    const body = new URLSearchParams({
      grant_type: "client_credentials",
      client_id: appId,
      client_secret: appPassword,
      scope: BOTFRAMEWORK_SCOPE,
    }).toString();
    const response = await this.http(`${LOGIN_ORIGIN}/${encodeURIComponent(authority)}/oauth2/v2.0/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
    });
    const payload = (await response.json().catch(() => null)) as
      | { access_token?: string; expires_in?: number | string; error?: string; error_description?: string }
      | null;
    if (!response.ok || !payload?.access_token) {
      // error_description can quote the request; keep only the error code.
      throw new Error(`Teams bot token request failed: ${payload?.error ?? `HTTP ${response.status}`}`);
    }
    return { token: payload.access_token, expiresInS: Number(payload.expires_in) || 3600 };
  }
}

async function getJson(http: HttpFetch, url: string): Promise<unknown> {
  const response = await http(url);
  if (!response.ok) throw new Error(`GET ${url}: HTTP ${response.status}`);
  return response.json();
}

/** Bot Framework compares service URLs loosely: case and a trailing slash
 *  differ between the claim and the activity in practice. */
export function sameServiceUrl(a: string, b: string): boolean {
  const norm = (value: string) => value.trim().toLowerCase().replace(/\/+$/, "");
  return norm(a) === norm(b);
}

/** One per process: the key cache and the token cache are both shared. */
export const botFrameworkAuth = new BotFrameworkAuth();
