/**
 * Shared contracts for the session stack (src/auth/*, src/bypassAcl/authSessionServices.ts, the
 * middlewares, the login controllers, push). Every stream compiles against this file; add to it,
 * do not change existing signatures.
 *
 * Model: ONE opaque session per device/browser (`auth_sessions` row, cookie `xs`) is the refresh
 * credential. Per workspace, a short-lived access JWT lives in the httpOnly cookie `xw_<ws>` and is
 * verified statelessly (signature + Redis tombstone on `sid`). The workspace is a per-request claim
 * (`x-workspace-id`, fallback `xyne_last_workspace`) authorised by the `public.users` membership
 * row when a JWT has to be minted. `workflow.user_sessions` is read-only legacy, converted on first read.
 */
import type { IncomingHttpHeaders } from 'http';
import type { CookieOptions, Request, Response } from 'express';
import type { AuthSession, OrgMember, User, UserSession } from '@prisma/client';
import type { AuthenticatedUser } from '@/types/express';
import type { LoginMethod } from '@/services/userSessionService';
import type { CredentialSource } from './sessionTokens';
import type { AuthSessionIssuedKind } from '@/services/otel/authMetrics';

// ─── Platform / cookies ──────────────────────────────────────────────────────

/** Platform as the login controllers see it (request side). */
export type RequestPlatform = 'web' | 'electron' | 'mobile';
/** `auth_sessions.platform` values (Platform enum + SDK). */
export type SessionPlatform = 'WEB' | 'ELECTRON' | 'MOBILE' | 'SDK';
export type CookieSameSite = 'strict' | 'lax' | 'none';
export type PushPlatform = 'ios' | 'android' | 'unknown';
export type MobileOs = 'ios' | 'android' | 'unknown';

/** A cookie write or clear, computed purely and applied with `applyCookies(res, list)`. */
export type CookieInstruction =
  | { kind: 'set'; name: string; value: string; options: CookieOptions }
  | { kind: 'clear'; name: string; options: CookieOptions };

/** `auth_sessions.revokeReason` values written by the stack. */
export type SessionRevokeReason =
  | 'USER_LOGOUT'
  | 'DEVICE_REUSED'
  | 'PASSWORD_CHANGED'
  | 'PASSWORD_RESET'
  | 'PROVIDER_REVOKED'
  | 'ACCOUNT_LEFT'
  | 'EXPIRED'
  | 'TEST_CLEANUP';

// ─── Request-attached session info ────────────────────────────────────────────

/**
 * `req.authSession` — present when the request resolved through an auth session: from the row on
 * the session path, from the JWT claims (`sid`, `memberId`, `orgId`, `platform`) on the stateless path.
 */
export interface AuthSessionInfo {
  sessionId: string;
  accountId: string;
  orgId: string;
  platform: SessionPlatform;
  /** Only known on the session path (the row was read). */
  absoluteExpiry?: Date;
}

// ─── Repository row shapes ────────────────────────────────────────────────────

export type AuthSessionRow = AuthSession;

export type LegacySessionWithUser = UserSession & {
  user: User & { orgMember: OrgMember | null };
};

/** The workspace `users` row an auth session acts as inside one workspace. */
export type MembershipUser = Pick<
  User,
  | 'id'
  | 'email'
  | 'name'
  | 'picture'
  | 'displayName'
  | 'workspaceId'
  | 'role'
  | 'orgMemberId'
  | 'authProvider'
  | 'providerUserId'
  | 'status'
  | 'leftAt'
>;

export type OrgMemberRef = Pick<OrgMember, 'memberId' | 'orgId' | 'role' | 'leftAt'>;

// ─── Resolver ─────────────────────────────────────────────────────────────────

/**
 * How the request authenticated.
 *   jwt_bearer / jwt_cookie    — session JWT (`sid` claims), stateless
 *   jwt_legacy                 — pre-deploy JWT without `sid` (Bearer), verified against the DB
 *   jwt_cookie_legacy          — JWT presented under the legacy `xyne_ws_<ws>_token` cookie name
 *   session                    — `xs` (or a legacy session credential) → row → membership → JWT minted
 *   session_converted          — same, and the `workflow.user_sessions` row was converted on this request
 */
export type AuthPath = 'jwt_bearer' | 'jwt_cookie' | 'jwt_legacy' | 'jwt_cookie_legacy' | 'session' | 'session_converted';

export type ResolveFailureReason =
  | 'no_credentials'
  | 'session_not_found'
  | 'session_expired'
  | 'session_revoked'
  | 'account_left'
  | 'workspace_user_left'
  | 'workspace_forbidden'
  | 'workspace_hint_missing'
  | 'workspace_mismatch'
  | 'user_not_found'
  | 'jwt_expired'
  | 'jwt_invalid'
  | 'jwt_revoked'
  | 'jwt_stale';

export interface ResolveInput {
  cookies: Record<string, string | undefined>;
  headers: IncomingHttpHeaders;
  /** Accept `Authorization: Bearer <jwt>` (v1 middleware, socket.io, sdk, MCP). */
  allowBearer: boolean;
  /** Explicit target workspace; wins over header and hint cookie (callInviteRouting). */
  workspaceId?: string;
  /**
   * Mint a fresh `xw_<ws>` from the session when the access cookie is missing, invalid or about to
   * expire (default true). False where Set-Cookie cannot reach the client (socket handshake, redirects).
   */
  inlineRefresh?: boolean;
}

/** Session resolved from a credential, before any workspace is chosen (refresh-session, login reuse). */
export interface SessionOnly {
  session: AuthSessionRow;
  orgMember: OrgMemberRef;
  /** The credential value the client presented (the `xs1_` token or a legacy id). */
  credential: string;
  /** Which cookie / header carried it. */
  source: CredentialSource;
  path: 'session' | 'session_converted';
}

/** Where a legacy credential came from, for the conversion log / counter. */
export type LegacyCredentialSource = CredentialSource | 'xyne_ws_cookie';

export interface LegacyConversionInfo {
  source: LegacyCredentialSource;
  /** True when the `workflow.user_sessions` row was converted into `auth_sessions` on this request. */
  rowCreated: boolean;
  /** `row_converted` | `cookies_migrated` (row already existed) | `jwt_reissued` (legacy JWT cookie re-issued as `xw_`). */
  outcome: 'row_converted' | 'cookies_migrated' | 'jwt_reissued';
  /** Legacy cookie names were mirrored instead of cleared (old mobile build under the version gate). */
  legacyMirror: boolean;
}

export interface ResolvedAuth {
  user: AuthenticatedUser;
  /** The `users` row behind `user`. Null on the stateless JWT path (claims only). */
  membership: MembershipUser | null;
  orgMember: OrgMemberRef;
  workspaceId: string;
  /** The row, when it was read (session path, or a pre-deploy JWT bound to a cookie session). */
  session: AuthSessionRow | null;
  /** `req.authSession`: from the row, or from the JWT claims. Null only for a pre-deploy JWT with no session. */
  sessionInfo: AuthSessionInfo | null;
  path: AuthPath;
  /** Cookies to apply: inline refresh, legacy conversion, legacy JWT re-issue. Empty otherwise. */
  cookies: CookieInstruction[];
  /** The access JWT this request is trusted under (verified cookie / Bearer, or the one just minted). */
  accessToken: string | null;
  legacyConversion: LegacyConversionInfo | null;
}

export interface ResolveFailure {
  ok: false;
  reason: ResolveFailureReason;
  status: 401 | 403;
  body: { error: string; message: string; code?: string };
}

export type ResolveResult = { ok: true; auth: ResolvedAuth } | ResolveFailure;
export type SessionOnlyResult = { ok: true; session: SessionOnly } | ResolveFailure;

// ─── Push ─────────────────────────────────────────────────────────────────────

/**
 * One deliverable push endpoint. `id` is `auth_sessions.id` when `source='session'` and the legacy
 * `user_sessions.id` when `source='legacy'`; `clearPushToken({ id, source })` takes both back.
 */
export interface PushTarget {
  id: string;
  source: 'session' | 'legacy';
  token: string;
  voipToken?: string;
  platform: PushPlatform;
  appVersion?: string;
}

export type PushTargetRef = Pick<PushTarget, 'id' | 'source'>;

export interface SetPushTokensInput {
  sessionId: string;
  /** Guard: the row must belong to this account. */
  accountId: string;
  fcmToken: string;
  voipToken: string | null;
  pushPlatform: PushPlatform;
  appVersion?: string | null;
  /** Mobile's stable device id; when present and different from the row's deviceKey it becomes the deviceKey. */
  deviceId?: string | null;
}

// ─── Repository (implemented by src/bypassAcl/authSessionServices.ts, faked in tests) ────────

export interface CreateSessionInput {
  accountId: string;
  orgId: string;
  tokenHash: string;
  deviceKey: string;
  platform: SessionPlatform;
  absoluteExpiry: Date;
  /** Already encrypted. */
  deviceInfo?: string | null;
  appVersion?: string | null;
  /** How `auth_session_issued_total` labels this row; defaults to `login`. */
  issuedKind?: AuthSessionIssuedKind;
}

export interface SessionRepository {
  findByTokenHash(tokenHash: string): Promise<AuthSessionRow | null>;
  findById(sessionId: string): Promise<AuthSessionRow | null>;
  /** Raw legacy row + user + orgMember, or null. */
  findLegacyRowForConversion(legacyId: string): Promise<LegacySessionWithUser | null>;
  /** Insert the auth_sessions row for a legacy row (idempotent on P2002: re-reads by tokenHash). */
  convertLegacySession(input: { legacy: LegacySessionWithUser; tokenHash: string }): Promise<AuthSessionRow>;
  /** Revokes other ACTIVE rows with the same deviceKey (DEVICE_REUSED), then inserts. */
  createSession(input: CreateSessionInput): Promise<AuthSessionRow>;
  /** `users` row with orgMemberId=accountId, workspaceId, status ACTIVE, leftAt null. */
  findMembership(accountId: string, workspaceId: string): Promise<MembershipUser | null>;
  findUserById(userId: string): Promise<MembershipUser | null>;
  findOrgMember(memberId: string): Promise<OrgMemberRef | null>;
  revokeSession(sessionId: string, reason: SessionRevokeReason): Promise<void>;
  /** Every ACTIVE row of the account → REVOKED (+ legacy rows of the account's users, status only). */
  revokeAccountSessions(accountId: string, reason: SessionRevokeReason): Promise<number>;
  /**
   * Is the account signed in on a real device anywhere? S2S rows (`s2s:` deviceKey) are excluded —
   * they are minted by background services and would otherwise keep answering "yes" forever —
   * and never-converted legacy `workflow.user_sessions` rows count, so an account that has not
   * made a request since the deploy is still considered live.
   */
  hasActiveSession(accountId: string, now?: Date): Promise<boolean>;
  /**
   * The one long-lived session row that server-to-server tokens for this account are pinned to
   * (deviceKey `s2s:<accountId>`), created on first use. Kept separate from device sessions so one
   * device's logout does not tombstone a background job's token, while an account-wide revoke does.
   */
  ensureServiceSession(accountId: string, orgId: string, now?: Date): Promise<AuthSessionRow>;
  /** ACTIVE rows past absoluteExpiry → EXPIRED, at most `batchSize`. Returns the count. */
  expireSessions(batchSize: number, now: Date): Promise<number>;
  /**
   * Make `deviceKey` the row's device key (client-supplied stable id): other ACTIVE rows holding that
   * key are revoked DEVICE_REUSED first. Guarded by accountId; false when the row is not the caller's.
   */
  adoptDeviceKey(sessionId: string, accountId: string, deviceKey: string): Promise<boolean>;
  // push
  setPushTokens(input: SetPushTokensInput): Promise<boolean>;
  clearPushTokens(sessionId: string): Promise<void>;
  /** Session rows of the account with a token ∪ legacy fallback rows; deduped by token, session first. */
  findPushTargetsForAccount(accountId: string, now?: Date): Promise<PushTarget[]>;
  /** Legacy exception (b): null the push columns on one legacy row after FCM UNREGISTERED. */
  nullLegacyPushColumns(legacySessionId: string): Promise<void>;
}

/** Redis tombstones for instant JWT revocation. */
/**
 * `ok` — trust the claims. `revoked` — the session behind the token is gone. `stale` — the
 * account's role / org role / workspace membership changed after the token was minted, so the
 * authorization it carries can no longer be trusted (re-mint from the session instead).
 */
export type ClaimsVerdict = 'ok' | 'revoked' | 'stale';

export interface RevocationStore {
  isRevoked(sid: string): Promise<boolean>;
  /** Tombstone + claims watermark in one round trip; `iat` is the token's epoch-second issue time. */
  checkClaims(input: { sid: string; accountId: string; iat?: number }): Promise<ClaimsVerdict>;
  markRevoked(sid: string, ttlSeconds: number): Promise<void>;
  /** Stamp the account's claims watermark (role / membership writers call this). */
  markClaimsStale(accountId: string, ttlSeconds: number, at?: Date): Promise<void>;
}

// ─── Issuer / login completion ───────────────────────────────────────────────

/** Everything a session JWT carries, so `req.user` / `req.authSession` need no DB read. */
export interface MintWorkspaceJwtInput {
  user: Pick<MembershipUser, 'id' | 'email' | 'name' | 'role'>;
  memberId: string;
  workspaceId: string;
  sid: string;
  orgId: string;
  orgRole: string;
  platform: SessionPlatform;
  expiresInSeconds?: number;
}

export interface IssueSessionInput {
  accountId: string;
  orgId: string;
  platform: SessionPlatform;
  req: Request;
  absoluteExpiry?: Date;
  appVersion?: string | null;
}

export interface IssueSessionResult {
  session: AuthSessionRow;
  /** `xs1_...` opaque token (the cookie value). */
  token: string;
  /** `xd` Set-Cookie when the request carried none. */
  deviceCookie: CookieInstruction | null;
}

export interface CompleteLoginInput {
  req: Request;
  res: Response;
  workspaceUser: MembershipUser;
  orgMember: Pick<OrgMember, 'memberId' | 'orgId' | 'role'>;
  /**
   * No `'sdk'`: SDK SSO issues its session and token directly (`routes/sdk-sso.ts`) because it
   * writes no cookies and approves on behalf of another client. Admitting it here left dead
   * branches in `completeLogin` for a caller that does not exist.
   */
  platform: RequestPlatform;
  loginMethod: LoginMethod;
  sameSite: CookieSameSite;
  isNewUser: boolean;
  /** Clear the pending-auth cookie after cookies are applied. */
  clearPending?: boolean;
  onboardingMaxAgeMs?: number;
}

export interface CompleteLoginResult {
  /** auth_sessions.id */
  sessionId: string;
  /** Opaque cookie value (`xs1_...`), returned to mobile/electron as `sessionId` in JSON. Null when an
   *  existing session was reused through a Bearer JWT and no cookie accompanied the request. */
  sessionToken: string | null;
  /** Workspace JWT for the login workspace (`sid` bound). Returned in JSON for non-web platforms. */
  token: string;
  workspaceId: string;
  /** `auth_sessions.platform` — what created the session. Use it for logging / push / claims. */
  platform: SessionPlatform;
  /**
   * What THIS response was shaped for (`auth/platform.responsePlatform`): MOBILE only when the
   * caller announced itself as native. Use it to decide whether the session token may travel in
   * the JSON body — a mobile browser must not read it.
   */
  responsePlatform: SessionPlatform;
  /** True when an existing session of the same account was reused (switch / create / join). */
  reused: boolean;
}

/** `POST /api/internal/auth/token` response body (parsed by claw-auth). */
export interface WorkspaceTokenResponse {
  token: string;
  /** Seconds. */
  expiresIn: number;
  workspaceId: string;
  userId: string;
}
