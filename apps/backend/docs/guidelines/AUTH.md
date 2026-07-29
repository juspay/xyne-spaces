# Authentication & Authorization Guide

Authentication and authorization using JWT tokens, API keys, and ACL. Located in `src/middleware/` and `src/services/`.

---

## Authentication Methods

| Method | Middleware | Use Case |
|--------|------------|----------|
| **Google OAuth** | `authMiddleware.authenticate` | Primary user login via Google |
| **API Key** | `authMiddleware.authenticate` | Programmatic access, integrations |
| **Zero Auth** | `authMiddleware.authenticateZero` | Zero sync endpoints (strict, no auto-refresh) |

---

## Middleware Chain

For most endpoints:
1. `authMiddleware.authenticate` - Validates user identity
2. `aclMiddleware.checkAccess` - Checks resource permissions
3. Route handler

For admin-only endpoints:
1. `authMiddleware.authenticate` - Validates user identity
2. `authMiddleware.requireAdmin` - Checks admin role
3. Route handler

For Zero endpoints:
1. `authMiddleware.authenticateZero` - Strict token validation (no refresh)
2. Route handler

---

## JWT Token Flow

**Token Storage:** HTTP-only cookie `google_access_token`

**Token Lifecycle:**
1. User logs in via Google OAuth
2. Backend generates custom JWT via `jwtService.generateToken()`
3. Token stored in HTTP-only cookie
4. Token validated on each request via `jwtService.verifyToken()`
5. If expired, auto-refresh via session (non-Zero endpoints)

**Token Payload:**
- `sub` - User ID
- `email` - User email
- `name` - User name
- `picture` - Profile picture URL (optional)
- `exp` - Expiration timestamp
- `iss` - Issuer (`xyne`)
- `aud` - Audience (`xyne-user`)

**Configuration:**
- `JWT_SECRET` - Secret key (minimum 32 characters)
- `config.jwt.expirationSeconds` - Token expiry time

---

## Zero Endpoint Authentication

**Purpose:** Strict authentication for Zero sync operations. No auto-refresh to prevent sync issues.

**Key Differences from Regular Auth:**

| Aspect | Regular Auth | Zero Auth |
|--------|--------------|-----------|
| Auto-refresh | Yes, via session | No, returns 401 |
| Token source | Cookie or header | Cookie only |
| On expiry | Refreshes automatically | Returns 401 immediately |
| Session ID | Uses for refresh | Not used |

**Why No Auto-Refresh:**
- Zero sync maintains persistent connections
- Frontend handles refresh explicitly before reconnecting

**Flow:**
1. Token extracted from `google_access_token` cookie
2. Verified via `jwtService.verifyToken()`
3. If invalid/expired, returns 401 (no retry)
4. Frontend receives 401, refreshes token, reconnects

**Location:** `src/middleware/auth.ts` - `authenticateZero` method

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

## Scope-Based Authorization

**Check Method:** `authMiddleware.requireScope(scopeName)`

**Applies To:** API key users only (OAuth users allowed by default)

**Admin Override:** Admin role users bypass scope checks

**Scope Format:** `resource:action` (e.g., `tickets:read`, `workflows:execute`)

---

## Session Management

**Service:** `UserSessionService`

**Session Table:** Stores refresh token info, expiry, last activity

**Session Cookie:** `user_session_id` - Links request to session for token refresh

**Session States:**
- `ACTIVE` - Valid session
- `EXPIRED` - Past refresh token expiry
- `REVOKED` - Manually invalidated


## Key Files

| File | Purpose |
|------|---------|
| `src/middleware/auth.ts` | Main auth middleware (authenticate, authenticateZero, requireAdmin, requireScope) |
| `src/middleware/acl.ts` | ACL middleware (checkAccess, optionalCheckAccess, skipACL) |
| `src/middleware/authorize.ts` | Legacy resource-based authorization |
| `src/services/jwtService.ts` | JWT generation and verification |
| `src/services/apiKeyService.ts` | API key validation and management |
| `src/services/aclService.ts` | ACL logic, permission checking |
| `src/services/userSessionService.ts` | Session management |

---

## Best Practices

1. **Always use `authenticate` before `requireAdmin`** - Admin check needs authenticated user

2. **Use Zero auth for Zero endpoints** - Prevents auto-refresh race conditions

3. **Store sensitive data in HTTP-only cookies** - Prevents XSS token theft

4. **Use scopes for API key granularity** - Limit API key permissions

5. **Check ACL for resource access** - Don't rely on authentication alone

6. **Validate session on token refresh** - Ensure session is still active

7. **Log authentication failures** - For security monitoring

---

## Anti-Patterns

- Using regular `authenticate` for Zero endpoints (causes sync issues)
- Storing tokens in localStorage (XSS vulnerable)
- Skipping ACL for sensitive resources
- Using dev mode headers in production
- Not validating token expiry before operations
- Creating custom auth middleware instead of using existing ones
