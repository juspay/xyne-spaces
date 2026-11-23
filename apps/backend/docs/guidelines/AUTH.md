# Authentication & Authorization Guide

Authentication and authorization using JWT tokens and ACL. Located in `src/middleware/` and `src/services/`.

---

## Authentication Methods

| Method | Middleware | Use Case |
|--------|------------|----------|
| **Google / Microsoft / Email login** | `authMiddleware.authenticate` | Every user route, Zero included; JWT cookie per workspace |

No middleware ever refreshes a token. An expired or missing JWT is a `401` with a `code`
(`TOKEN_MISSING`, `TOKEN_EXPIRED`); the client calls `GET /api/auth/refresh-session` and retries.
Every other code is final and sends the client to login: `TOKEN_INVALID`, `SESSION_REVOKED` (the
token's auth session is no longer ACTIVE), `USER_REMOVED`, `EMAIL_DOMAIN_NOT_ALLOWED`.

The JWT is read only from the `xyne_ws_<workspaceId>_token` cookie; an `Authorization` header is never
accepted as a user credential. Every request re-checks, in Postgres, the auth session behind the token's
`sid` (ACTIVE, unexpired), the user (`status`, `leftAt`) and the org member (`leftAt`).

---

## Middleware Chain

For most endpoints:
1. `authMiddleware.authenticate` - Validates user identity, then decrypts an encrypted body (`decryptRequestBodyMiddleware`)
2. `aclMiddleware.checkAccess` - Checks resource permissions
3. Route handler

For admin-only endpoints:
1. `authMiddleware.authenticate` - Validates user identity
2. `authMiddleware.requireAdmin` - Checks admin role
3. Route handler

---

## Credentials and Cookies

| Cookie | Set by | Lifetime | Purpose |
|--------|--------|----------|---------|
| `xs` | `authSessionService.issueOnLogin` (every login) | `SESSION_EXPIRY_DAYS`, fixed at login | **Refresh token.** `Path=/api/auth/refresh-session`: the browser sends it to that endpoint only, never on ordinary API calls. Raw random token; only its sha256 is stored in `non_zero.auth_sessions.refreshToken`. One ACTIVE row per `(orgMemberId, deviceKey)`; the device key is the `x-device-id` header (web/electron `localStorage.xd`). Org-level: shared by every workspace the user enters. |
| `xyne_ws_<workspaceId>_token` | `accessTokenService.setAccessCookies` | `min(JWT_EXPIRATION_SECONDS, time left on xs)` | **Access token** (JWT) for one workspace. |
| `xyne_last_workspace` | same | `SESSION_EXPIRY_DAYS` | Which workspace token to read, and which workspace `/auth/refresh-session` re-mints for. |
| `xyne_pending_auth` | OAuth callbacks, email login | 10 min | Pending identity between the provider callback and `/auth/login-workspace`. Not an access token. |

All are httpOnly; `SameSite=Strict` (`Lax` on OAuth callback redirects, `None` for native mobile).

Requests must send `x-device-id` on login routes: a login without it is rejected with `400 DEVICE_ID_REQUIRED`.

---

## JWT Token Flow

**Token Lifecycle:**
1. User logs in (Google / Microsoft / email). Every flow ends in `services/loginCompletionService.completeLogin`:
   auth session (`xs`) → JWT cookies → AUTH/LOGIN activity event → contacts grant.
2. Token validated on each request via `accessTokenService.readWorkspaceJwt()`: signature and expiry,
   claims (`sub`, `memberId`, `sid`, `workspaceId` = the cookie's workspace), and the `sid` auth session
   ACTIVE and unexpired in Postgres. A revoked session → `401 SESSION_REVOKED`.
3. Expired → `401 TOKEN_EXPIRED`. Client calls `GET /api/auth/refresh-session`.
4. `refreshSession` (`authV2Controller`) validates `xs` (`authSessionService.validateRefresh`), picks the workspace from
   `xyne_last_workspace`, checks the user row (`status`, `leftAt`) and sets a fresh `xyne_ws_*` cookie.
5. `xs` expired/revoked → `401 REFRESH_INVALID` → client goes to the login page.

**Token Payload:**
- `sub` - User ID (workspace user row)
- `email`, `name`, `picture`
- `workspaceId` - Workspace the token is for
- `memberId` - Org member ID
- `sid` - **Auth session ID** (`auth_sessions.id`). Client encryption keys, mobile push tokens and activity
  platform are keyed on it (`req.user.sid`).
- `exp`, `iss` (`xyne`), `aud` (`xyne-user`)

**Workspace switch / create:** reuses the caller's `xs` session; a new JWT is minted under the same `sid`
(`issueAccessCookies`). No new auth session.

**Configuration:**
- `JWT_SECRET` - Secret key (minimum 32 characters)
- `JWT_EXPIRATION_SECONDS` - Max access-token lifetime
- `SESSION_EXPIRY_DAYS` - Refresh session lifetime

---

## Zero Endpoint Authentication

**Purpose:** Authentication for Zero sync operations (`/api/zero/*`). Same credentials as every other route;
zero-cache forwards the browser cookies.

**Flow:**
1. Token extracted from `xyne_ws_<workspaceId>_token` (workspace from `x-workspace-id` or `xyne_last_workspace`)
2. Verified by `authenticate` (`readWorkspaceJwt`); `zeroController` forwards that same token
   (`req.authToken`) to Zero as `Authorization`, replacing anything the client sent
3. If invalid/expired/revoked, returns 401 (no retry)
4. Zero reports `needs-auth`; the dashboard calls `/auth/refresh-session` and reconnects

**Location:** `src/middleware/auth.ts` - `authenticate`

---

## Admin Authentication

**Check Method:** `authMiddleware.requireAdmin`

**Admin Criteria:**
- `req.user.role === 'admin'`

**Usage:** Chain after `authenticate` middleware for admin-only routes

**ACL Skip:** Admin users (real or virtual) skip ACL checks automatically

---

## Access Control (ACL)

**Service:** `aclService` - Permission checking by resource and action

**Middleware:** `aclMiddleware.checkAccess`

**How It Works:**
1. Extract resource name from URL path (e.g., `/api/tickets` -> `TICKETS`)
2. Map HTTP method to access type (`GET` -> `READ`, `POST/PUT/DELETE` -> `WRITE`)
3. Check `ResourceAccess` table for user permissions
4. Grant or deny access

**Resources:** Stored in `Resource` table, permissions in `ResourceAccess` table

**Access Types:**
- `READ` - GET, HEAD, OPTIONS requests
- `WRITE` - POST, PUT, PATCH, DELETE requests

**Skip ACL:**
- Admin users bypass ACL checks
- Use `aclMiddleware.skipACL` for public endpoints
- Use `aclMiddleware.optionalCheckAccess` for optional auth endpoints

---

## Session Management

**Service:** `authSessionService` (`src/services/authSessionService.ts`)

**Table:** `non_zero.auth_sessions` (+ `auth_session_workspace_access`: one row per workspace the session entered)

**Key operations:**
- `issueOnLogin` - revoke the device's previous ACTIVE row, create the new one, set `xs`
- `validateRefresh` - `xs` cookie → ACTIVE, unexpired session + org member (null when the member left); only `/auth/refresh-session` can call it
- `findActiveById` - ACTIVE, unexpired session by the JWT `sid`; `readWorkspaceJwt` calls it for every access token, and switch/create workspace use it for the session's expiry
- `revokeOnLogout` - revoke by the JWT `sid` and/or `(orgMemberId, deviceKey)`, clear `xs`
- `accessTokenService.readWorkspaceJwt` is the one place a user access token is accepted: `authenticate` and the public routes that need "is this caller signed in" (`login-workspace`, join requests, call-invite routing) all call it. An expired JWT answers so the client refreshes and retries (`needs-refresh` for call-invite routing); a revoked one is final
- `revokeAllForOrgMember` - password change/reset, account deactivation: sign out every device
- `createExternalSession` / `rotateTokenHash` - SDK SSO refresh sessions (platform `sdk`)

**Session States:** `ACTIVE`, `REVOKED` (`revokeReason`: `superseded`, `logout`, `password_changed`,
`password_reset`, `account_deactivated`, `refresh_token_reused`, …). Expiry is `refreshTokenExpiry`,
never extended.

**Revocation:** revoking a session is the `auth_sessions` row update, nothing else. Because
`readWorkspaceJwt` reads that row on every request, every JWT minted under the session (all carry its
`sid`) is rejected from the next request on. There is no denylist or cache to keep in sync; do not add
one that can answer "not revoked" on its own (a miss or an error must fall through to Postgres).

**Legacy:** `workflow.user_sessions` (`UserSession`) is no longer read or written; the table and Prisma model
remain only until a later cleanup.

## Key Files

| File | Purpose |
|------|---------|
| `src/middleware/auth.ts` | The auth middleware (authenticate, requireAdmin, requireAdminOrOwner) |
| `src/middleware/decryptionMiddleware.ts` | Session-key request decryption (run by the auth middlewares) / response encryption |
| `src/middleware/acl.ts` | ACL middleware (checkAccess, optionalCheckAccess, skipACL) |
| `src/middleware/authorize.ts` | Legacy resource-based authorization |
| `src/services/jwtService.ts` | JWT generation and verification |
| `src/services/accessTokenService.ts` | Mint the JWT (`sid`, capped lifetime) and write the access cookies |
| `src/services/loginCompletionService.ts` | Shared login tail: auth session + cookies + activity + contacts grant |
| `src/services/authSessionService.ts` | Refresh sessions (`xs`, `auth_sessions`) |
| `src/services/aclService.ts` | ACL logic, permission checking |

---

## Best Practices

1. **Always use `authenticate` before `requireAdmin`** - Admin check needs authenticated user

2. **Never refresh inside a middleware** - `/auth/refresh-session` is the only place a JWT is re-minted

3. **Store sensitive data in HTTP-only cookies** - Prevents XSS token theft

4. **Check ACL for resource access** - Don't rely on authentication alone

5. **Key per-device state on `req.user.sid`** - Encryption keys, push tokens; never on cookies read by hand

6. **Log authentication failures** - For security monitoring

---

## Anti-Patterns

- Minting a JWT anywhere other than `accessTokenService` / `completeLogin` / `refreshSession`
- Accepting a user JWT with `jwtService.verifyToken` (or `jwt.verify`) directly: it skips the
  auth-session check. Use `authenticate`, or `readWorkspaceJwt` on public routes
- Forwarding a token to a downstream verifier (e.g. Zero) other than `req.authToken`, the one
  `authenticate` checked
- Storing tokens in localStorage (XSS vulnerable)
- Skipping ACL for sensitive resources
- Not validating token expiry before operations
- Creating custom auth middleware instead of using existing ones
