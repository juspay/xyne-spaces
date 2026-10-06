/**
 * Shared contracts for the account-session auth stack (src/auth/*, src/bypassAcl/authSessionServices.ts,
 * the two auth middlewares and the login controllers). Every stream compiles against this file;
 * add to it, do not change existing signatures.
 */
import type { IncomingHttpHeaders } from 'http';
import type { CookieOptions, Request, Response } from 'express';
import type { AuthSession, OrgMember, SessionWorkspaceGrant, User, UserSession } from '@prisma/client';
import type { AuthenticatedUser } from '@/types/express';
import type { JwtPayload } from '@/services/jwtService';
import type { LoginMethod } from '@/services/userSessionService';

// ─── Flags ────────────────────────────────────────────────────────────────────

export type AuthSessionWriteMode = 'legacy' | 'dual' | 'v3';
export type AuthSessionReadMode = 'legacy' | 'v3_with_legacy_fallback' | 'v3';
export type AuthCookieMode = 'legacy' | 'dual' | 'v3';
export type SessionTokenMode = 'legacy' | 'hashed';

export interface AuthSessionFlags {
  writeMode: AuthSessionWriteMode;
  readMode: AuthSessionReadMode;
  cookieMode: AuthCookieMode;
  tokenMode: SessionTokenMode;
  /** `all` or explicit org ids; orgs outside are issued legacy/legacy. */
  v3Orgs: 'all' | string[];
}

// ─── Platform / cookies ──────────────────────────────────────────────────────

/** Platform as the login controllers see it (request side). */
export type RequestPlatform = 'web' | 'electron' | 'mobile';
/** `auth_sessions.platform` values (Platform enum + SDK). */
export type SessionPlatform = 'WEB' | 'ELECTRON' | 'MOBILE' | 'SDK';
export type CookieSameSite = 'strict' | 'lax' | 'none';

/** A cookie write or clear, computed purely and applied with `applyCookies(res, list)`. */
export type CookieInstruction =
  | { kind: 'set'; name: string; value: string; options: CookieOptions }
  | { kind: 'clear'; name: string; options: CookieOptions };

// ─── Request-attached session info ────────────────────────────────────────────

/** `req.authSession` — present only when the request resolved through a v3 auth session. */
export interface AuthSessionInfo {
  sessionId: string;
  grantId: string;
  accountId: string;
  workspaceId: string;
  /** The `workflow.user_sessions` row of the grant (indexes fcm / encryption); null in WRITE_MODE=v3. */
  legacySessionId: string | null;
  platform: SessionPlatform;
}

/** What a login/switch/create/join handler passes as the "already signed in" session. */
export interface ExistingSessionRef {
  sessionId?: string | null;
  legacySessionId?: string | null;
}

// ─── Repository row shapes ────────────────────────────────────────────────────

export type AuthSessionWithGrants = AuthSession & { grants: SessionWorkspaceGrant[] };

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

export type AuthPath =
  | 'jwt_bearer'
  | 'jwt_cookie'
  | 'v3_cookie'
  | 'v3_header'
  | 'legacy_mapped'
  | 'legacy_cookie'
  | 'legacy_header';

export type ResolveFailureReason =
  | 'no_credentials'
  | 'session_not_found'
  | 'session_expired'
  | 'session_revoked'
  | 'account_left'
  | 'workspace_user_left'
  | 'workspace_forbidden'
  | 'workspace_hint_missing'
  | 'workspace_context_missing'
  | 'user_not_found'
  | 'jwt_expired'
  | 'jwt_invalid'
  | 'jwt_revoked';

export interface ResolveInput {
  cookies: Record<string, string | undefined>;
  headers: IncomingHttpHeaders;
  /** Accept `Authorization: Bearer <jwt>` (v1 middleware, sdk-sso, MCP). */
  allowBearer: boolean;
  /** Fall through to the session path when the JWT is missing/expired. */
  allowAutoRefresh: boolean;
  /** `refresh-endpoint`: no hint ⇒ return the session without requiring a grant. */
  mode?: 'request' | 'refresh-endpoint';
  /** Explicit target workspace; wins over header and hint cookie (callInviteRouting). */
  workspaceId?: string;
  /** Mint a grant on `x-workspace-id` without one when an active membership exists. Default true. */
  allowAutoGrant?: boolean;
  /** Source ip / user agent for lazily-created legacy rows. */
  ip?: string;
  userAgent?: string;
}

export interface ResolvedAuth {
  user: AuthenticatedUser;
  workspaceId: string;
  session: AuthSessionWithGrants | null;
  grant: SessionWorkspaceGrant | null;
  legacySession: LegacySessionWithUser | null;
  /** The id that indexes `workflow.user_sessions` for this request (= `req.authenticatedSessionId`). */
  legacySessionId: string | null;
  path: AuthPath;
  /** Set when the session path minted a new JWT; middleware applies the cookies. */
  refreshed: { jwt: string; cookies: CookieInstruction[] } | null;
  jwtPayload: JwtPayload | null;
  /** True when a grant was lazily minted during this resolve. */
  lazyGranted?: boolean;
}

export interface ResolveFailure {
  ok: false;
  reason: ResolveFailureReason;
  status: 401 | 403;
  body: { error: string; message: string; code?: string };
}

export type ResolveResult = { ok: true; auth: ResolvedAuth } | ResolveFailure;

export interface AddGrantInput {
  session: AuthSessionWithGrants;
  user: MembershipUser;
  kind: 'switch' | 'lazy_grant' | 'create' | 'join' | 'backfill';
  ip?: string;
  deviceInfo?: string;
}

export interface AddGrantResult {
  grant: SessionWorkspaceGrant;
  /** Dual-written legacy row for this grant; null in WRITE_MODE=v3. */
  legacySessionId: string | null;
  created: boolean;
}

/** DB access the resolver needs; implemented by src/bypassAcl/authSessionServices.ts, faked in tests. */
export interface SessionRepository {
  /** `xs1_` payload → ACTIVE session (hash match or id match), grants included. */
  findSessionByToken(payload: string): Promise<AuthSessionWithGrants | null>;
  /** Legacy id → session via grant.legacySessionId first, then session.legacySessionId. */
  findSessionByLegacyId(
    legacyId: string,
  ): Promise<{ session: AuthSessionWithGrants; grant: SessionWorkspaceGrant | null } | null>;
  /** Raw `workflow.user_sessions` row with user + orgMember (old getSessionById). */
  findLegacySession(id: string): Promise<LegacySessionWithUser | null>;
  /** `users` row with orgMemberId=accountId, workspaceId, status ACTIVE, leftAt null. */
  findActiveMembership(accountId: string, workspaceId: string): Promise<MembershipUser | null>;
  findUserById(userId: string): Promise<MembershipUser | null>;
  findOrgMember(memberId: string): Promise<OrgMemberRef | null>;
  addGrant(input: AddGrantInput): Promise<AddGrantResult>;
  revokeGrant(grantId: string, reason: string): Promise<void>;
  revokeSessionCascade(sessionId: string, reason: string): Promise<void>;
  /** Throttled by the caller; updates lastSeenAt + legacy lastActivity. */
  touchSession(sessionId: string, legacySessionIds: string[], now: Date): Promise<void>;
  touchLegacySession(legacySessionId: string, now: Date): Promise<void>;
}

/** Redis tombstones for instant JWT revocation. */
export interface RevocationStore {
  isRevoked(sid: string): Promise<boolean>;
  markRevoked(sid: string, ttlSeconds: number): Promise<void>;
}

// ─── Issuer / login completion ───────────────────────────────────────────────

export interface Issuance {
  session: AuthSessionWithGrants | null;
  grant: SessionWorkspaceGrant | null;
  /** Always present: the legacy row id for the issued grant (login row on login). */
  legacySessionId: string;
  /** `xs1_...` or null when the org/flags issued legacy-only. */
  sessionToken: string | null;
  jwt: string;
  cookies: CookieInstruction[];
  workspaceId: string;
  sessionExpiresAt: Date;
}

export interface IssueLoginInput {
  user: MembershipUser;
  orgMember: Pick<OrgMember, 'memberId' | 'orgId'>;
  req: Request;
  platform: RequestPlatform | 'sdk';
  loginMethod: LoginMethod;
  amr?: string[];
  sameSite: CookieSameSite;
  isNewUser?: boolean;
}

export interface IssueWorkspaceSwitchInput {
  current: ExistingSessionRef;
  targetUser: MembershipUser;
  req: Request;
  platform: RequestPlatform;
  loginMethod: LoginMethod;
  sameSite: CookieSameSite;
  kind?: 'switch' | 'create' | 'join';
}

export interface IssueRefreshInput {
  session: AuthSessionWithGrants;
  grants: SessionWorkspaceGrant[];
  /** When set, only this workspace gets a token. */
  hint?: string;
  sameSite: CookieSameSite;
  path: AuthPath;
}

export interface MintWorkspaceJwtInput {
  user: Pick<MembershipUser, 'id' | 'email' | 'name' | 'picture' | 'providerUserId' | 'authProvider'>;
  memberId: string;
  workspaceId: string;
  sid?: string;
  lsid?: string;
  provider?: string;
  expiresInSeconds?: number;
}

export interface CompleteLoginInput {
  req: Request;
  res: Response;
  workspaceUser: MembershipUser;
  loginMethod: LoginMethod;
  platform: RequestPlatform;
  sameSite: CookieSameSite;
  isNewUser: boolean;
  /** Already signed in (switch / create / join): adds a grant to this session instead of a new login. */
  existingSession?: ExistingSessionRef | null;
  /** Clear the pending-auth cookie after cookies are applied. */
  pending?: boolean;
  onboardingMaxAgeMs?: number;
  amr?: string[];
}

export interface CompleteLoginResult {
  session: AuthSessionWithGrants | null;
  grant: SessionWorkspaceGrant | null;
  jwt: string;
  legacySessionId: string;
  workspaceId: string;
  sessionToken: string | null;
}
