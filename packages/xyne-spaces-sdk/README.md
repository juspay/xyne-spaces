# @xyne/spaces-sdk

TypeScript SDK for Xyne Spaces. **455 methods across 24 resources**, covering the
complete operation catalog — every read and write the Spaces product itself
performs.

```typescript
import { createClient } from '@xyne/spaces-sdk';

const sdk = createClient({
  baseUrl: 'https://spaces.example.com',
  token: process.env.XYNE_SPACES_TOKEN,
});

const me = await sdk.users.me();
const channels = await sdk.channels.list();

const { id: channelId } = await sdk.channels.create({
  scopeType: 'DEFAULT',
  projectId: 'project-1',
  name: 'Deployments',
});

const { conversationId } = await sdk.conversations.create({
  channelId,
  content: 'Deploy is green.',
});

await sdk.messages.send({ conversationId, content: 'Ship it.' });
```

## Install

```bash
pnpm add @xyne/spaces-sdk
```

Node 18+ or any modern browser. No runtime dependencies.

## Authentication

The SDK authenticates every API request with an OAuth bearer access token:

```http
Authorization: Bearer <access_token>
```

It does **not** redirect users, exchange authorization codes, persist refresh
tokens, or refresh a session automatically. Your application owns that OAuth
lifecycle and gives the current access token to the SDK:

```typescript
const sdk = createClient({
  // Use the Spaces origin. The SDK adds /api/sdk to its requests.
  baseUrl: process.env.XYNE_SPACES_BASE_URL,
  token: accessToken,
});
```

Spaces implements the OAuth 2.0 authorization-code flow for public clients,
with mandatory PKCE using `S256`. There is no client secret. A token represents
the user who approved access, their workspace, the OAuth client, and the scopes
they granted.

### Configure an OAuth client

Choose these values in the application that uses the SDK. These variable names
are examples; the SDK does not read environment variables itself.

```dotenv
XYNE_SPACES_BASE_URL=http://localhost:3001
XYNE_SPACES_OAUTH_BASE_URL=http://localhost:3001/api/sdk/oauth
XYNE_SPACES_CLIENT_ID=my-chat-app
XYNE_SPACES_REDIRECT_URI=http://localhost:4173/auth/callback
XYNE_SPACES_SCOPES=spaces.channels:read spaces.conversations:read spaces.messages:read spaces.messages:write spaces.users:read
```

The Spaces deployment administrator must register the public client id and each
exact callback URI. On a self-hosted backend that is the
`SDK_OAUTH_CLIENTS` setting:

```dotenv
SDK_OAUTH_CLIENTS={"my-chat-app":["http://localhost:4173/auth/callback","https://chat.example.com/auth/callback"]}
```

The backend must also have the public SDK API and OAuth server enabled with an
RSA signing key. The private key belongs only on the Spaces backend; SDK
applications must never receive it.

```dotenv
SDK_API_ENABLED=true
SDK_OAUTH_ENABLED=true
SDK_JWT_PRIVATE_KEY_FILE=./sdk-jwt.pem
SDK_JWT_KEY_ID=sdk-key-1
```

Generate a development key with `openssl genrsa -out sdk-jwt.pem 2048`. In
production, keep the key in a secret manager and use HTTPS callback URIs. A
self-hosted deployment must also apply the backend Prisma migrations that create
the SDK authorization-code and refresh-token tables.

### Sign in with authorization code + PKCE

OAuth endpoints are advertised at:

```text
{XYNE_SPACES_OAUTH_BASE_URL}/.well-known/oauth-authorization-server
```

The flow is:

1. Generate a random PKCE `code_verifier`, its SHA-256 `code_challenge`, and a
   random `state` value. Store the verifier and state in the user's server-side
   session, or in `sessionStorage` for a browser-only client.
2. Navigate the browser to the authorization endpoint. Use a top-level browser
   navigation, not `fetch()` or an iframe. The user signs into Spaces if needed,
   reviews the requested scopes, and approves or denies them.
3. Spaces redirects to the registered callback with `code` and `state`. Reject
   the callback unless `state` exactly matches the stored value.
4. Exchange the one-time code and original verifier for tokens.

```typescript
// Supply these from your framework's public runtime/build configuration.
// The client id is public; there is deliberately no client secret.
const oauthBaseUrl = 'http://localhost:3001/api/sdk/oauth';
const clientId = 'my-chat-app';
const redirectUri = 'http://localhost:4173/auth/callback';
const requestedScopes = [
  'spaces.channels:read',
  'spaces.conversations:read',
  'spaces.messages:read',
  'spaces.messages:write',
  'spaces.users:read',
];

function base64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

const verifier = base64url(crypto.getRandomValues(new Uint8Array(32)));
const digest = await crypto.subtle.digest(
  'SHA-256',
  new TextEncoder().encode(verifier),
);
const challenge = base64url(new Uint8Array(digest));
const state = base64url(crypto.getRandomValues(new Uint8Array(32)));

// Save { verifier, state } before redirecting.
const authorizeUrl = new URL(`${oauthBaseUrl}/authorize`);
authorizeUrl.searchParams.set('response_type', 'code');
authorizeUrl.searchParams.set('client_id', clientId);
authorizeUrl.searchParams.set('redirect_uri', redirectUri);
authorizeUrl.searchParams.set('scope', requestedScopes.join(' '));
authorizeUrl.searchParams.set('state', state);
authorizeUrl.searchParams.set('code_challenge', challenge);
authorizeUrl.searchParams.set('code_challenge_method', 'S256');

window.location.assign(authorizeUrl);
```

At the callback, after validating `state`, exchange the returned code:

```typescript
const callbackUrl = new URL(window.location.href);
const code = callbackUrl.searchParams.get('code');
const returnedState = callbackUrl.searchParams.get('state');
const pending = loadPendingLogin(); // The previously saved { verifier, state }.

if (!code || !pending || returnedState !== pending.state) {
  throw new Error('Invalid OAuth callback');
}

const response = await fetch(`${oauthBaseUrl}/token`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    grant_type: 'authorization_code',
    client_id: clientId,
    code,
    redirect_uri: redirectUri,
    code_verifier: pending.verifier,
  }),
});

if (!response.ok) throw new Error('Spaces authorization failed');

const tokens = await response.json() as {
  access_token: string;
  token_type: 'Bearer';
  expires_in: number;
  refresh_token: string;
  scope: string;
};

sdk.setToken(tokens.access_token);
```

Authorization codes expire after 10 minutes by default and can be used only
once. Access tokens expire after 15 minutes by default.

### Refresh and sign out

Exchange the current refresh token before the access token expires, then put the
new access token into the existing SDK client:

```typescript
const response = await fetch(`${oauthBaseUrl}/token`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    grant_type: 'refresh_token',
    client_id: clientId,
    refresh_token: currentRefreshToken,
  }),
});

if (!response.ok) throw new Error('Spaces token refresh failed');

const next = await response.json() as {
  access_token: string;
  expires_in: number;
  refresh_token: string;
  scope: string;
};
sdk.setToken(next.access_token);

// Refresh tokens rotate. Replace both stored tokens together; never reuse the
// old refresh token.
saveTokens(next.access_token, next.refresh_token, next.expires_in);
```

Refresh tokens last 30 days by default and are single-use. Every successful
refresh returns a replacement. Reusing an already-rotated refresh token revokes
its entire token family and requires a fresh sign-in.

For logout, revoke the refresh token and clear the SDK token:

```typescript
await fetch(`${oauthBaseUrl}/revoke`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ token: currentRefreshToken, client_id: clientId }),
});

sdk.clearToken();
```

For production browser applications, prefer a small backend-for-frontend that
keeps refresh tokens in an encrypted server-side session and identifies that
session with a `Secure`, `HttpOnly`, `SameSite` cookie. Keep the short-lived
access token in memory; do not put refresh tokens in `localStorage`.

### Read the current token identity

`sdk.users.me()` reads the caller identity from the access token's own claims,
so it costs no round trip:

```typescript
const me = await sdk.users.me();
// { id, email, name, workspaceId, memberId, clientId, scopes, expiresAt }

if (await sdk.users.isSessionExpired()) {
  sdk.setToken(await refreshSomehow());
}
```

This local decoding is for application convenience, not authorization. The SDK
does not verify the token signature; the Spaces API performs the authoritative
signature, expiry, account, workspace, role, scope, and row-access checks.

A few operations take the acting user's id as an argument rather than reading it
server-side — `sdk.dashboards.upsert`, `sdk.tickets.upsertStageRequest`. Pass
`me.id`:

```typescript
await sdk.dashboards.upsert({ name: 'Ops', createdBy: me.id });
```

## Scopes

Scopes limit which parts of the public API a token may call. Request only the
scopes the application needs and pass them as a space-separated `scope`
parameter during authorization. Explicitly send this parameter: omitting it
currently asks for every supported scope.

Read and write grants are independent. For example,
`spaces.messages:write` permits message mutations but does not imply
`spaces.messages:read`. Most resource families have both forms:

| Resource family | Read scope | Write scope |
|---|---|---|
| Channels | `spaces.channels:read` | `spaces.channels:write` |
| Conversations | `spaces.conversations:read` | `spaces.conversations:write` |
| Messages | `spaces.messages:read` | `spaces.messages:write` |
| Calls | `spaces.calls:read` | `spaces.calls:write` |
| Tickets and support tickets | `spaces.tickets:read` | `spaces.tickets:write` |
| Boards and stages | `spaces.boards:read` | `spaces.boards:write` |
| Projects | `spaces.projects:read` | `spaces.projects:write` |
| Canvases | `spaces.canvases:read` | `spaces.canvases:write` |
| Collections | `spaces.collections:read` | `spaces.collections:write` |
| Forms | `spaces.forms:read` | `spaces.forms:write` |
| Releases, RCAs, CoEs, and impacts | `spaces.releases:read` | `spaces.releases:write` |
| Automations | `spaces.automations:read` | `spaces.automations:write` |
| Email | `spaces.email:read` | `spaces.email:write` |
| Users and user groups | `spaces.users:read` | `spaces.users:write` |
| Activities | `spaces.activities:read` | `spaces.activities:write` |
| Dashboards | `spaces.dashboards:read` | `spaces.dashboards:write` |
| Recaps | `spaces.recaps:read` | `spaces.recaps:write` |
| Shared links | `spaces.links:read` | `spaces.links:write` |
| Repositories | `spaces.repos:read` | `spaces.repos:write` |
| Attachments | `spaces.attachments:read` | `spaces.attachments:write` |
| Search | `spaces.search:read` | — |

`spaces.admin` is the API-surface super-scope used for workspace and
organization administration. Grant it only to applications that genuinely
administer Spaces. It satisfies endpoint scope checks, but it does not turn a
normal Spaces user into an administrator or bypass workspace and row-level
access controls.

Some SDK methods cross resource families. For example, a view that lists
channels, loads their threads, reads messages, and resolves authors needs four
read scopes:

```text
spaces.channels:read
spaces.conversations:read
spaces.messages:read
spaces.users:read
```

A chat application that also starts threads, sends messages, and uploads files
would normally add:

```text
spaces.conversations:write
spaces.messages:write
spaces.attachments:write
```

The authorization-server discovery response contains the deployment's current
`scopes_supported` list. The token response returns the scopes actually granted,
and `sdk.users.me().scopes` exposes the same list from the access-token claims.
Calling a method without a required scope returns HTTP 403 as an `SdkError` with
code `forbidden`; it is not an authentication failure. A valid scope still only
allows data that the approving user can access normally.

## Resources

| Resource | Methods |
|---|---|
| `sdk.activities` | 14 |
| `sdk.attachments` | 2 |
| `sdk.admin` | 31 |
| `sdk.automations` | 13 |
| `sdk.boards` | 22 |
| `sdk.calls` | 24 |
| `sdk.claw` | 7 · [separate login](#claw-remote-agents) |
| `sdk.canvases` | 38 |
| `sdk.channels` | 41 |
| `sdk.collections` | 11 |
| `sdk.conversations` | 21 |
| `sdk.dashboards` | 8 |
| `sdk.email` | 27 |
| `sdk.forms` | 13 |
| `sdk.incidents` | 23 |
| `sdk.messages` | 33 |
| `sdk.preferences` | 18 |
| `sdk.projects` | 13 |
| `sdk.recaps` | 10 |
| `sdk.search` | 2 |
| `sdk.supportTickets` | 6 |
| `sdk.tickets` | 41 |
| `sdk.userGroups` | 18 |
| `sdk.users` | 6 |
| `sdk.workspace` | 20 |

## Claw: remote agents

`sdk.claw` dispatches tasks to Xyne Claw agents. It is the one resource with **its own login** —
Claw is served by a different service whose verifier accepts only its own `xyne_cli_` tokens, so
your Spaces token is not valid there and vice versa. `setToken()` and `setClawToken()` never affect
each other.

The SDK stays browser-safe and dependency-free, so it cannot open a browser or write a credential
file. Login runs the device flow and hands you the parts a human has to see:

```typescript
await sdk.claw.login({
  onPrompt: ({ verifyUrl, userCode }) =>
    console.log(`Open ${verifyUrl} and enter ${userCode}`),
});

const agents = await sdk.claw.listAgents();
const { run } = await sdk.claw.runAgentAndWait({
  agent: 'ask-ai',
  task: 'Summarise yesterday in #deploys',
  timeoutMs: 600_000,
});
if (run.status === 'completed') console.log(run.result);
```

**Persisting the token** is up to the host, via a small store. In Node, point it at the same file
the Xyne CLI uses and one login covers both:

```typescript
const path = join(homedir(), '.xyne', 'agent', 'claw.json');

const sdk = createClient({
  token: process.env.XYNE_SPACES_TOKEN,
  clawTokenStore: {
    get: () => (existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')).token : undefined),
    set: (token) => writeFileSync(path, JSON.stringify({ token }, null, 2)),
    clear: () => rmSync(path, { force: true }),
  },
});
```

With a store configured, `sdk.claw` picks up a saved token on first use — no `login()` needed.

**Runs are asynchronous.** `runAgent` returns as soon as the run exists; `runAgentAndWait` polls for
you with backoff. A timeout does not cancel the run, so pick it up later:

```typescript
const { sessionId } = await sdk.claw.runAgent({ agent: 'ask-ai', task: '…' });
const { run, detail } = await sdk.claw.getRun(sessionId);   // detail = tool calls, timing, tokens
```

**Replies can land in Spaces.** Pass a `channelId` from `sdk.channels.list()` and the agent posts
its answer into that thread, or `deliverTo: 'dm'` for your own DM. This is the only place the two
surfaces meet.

## Things worth knowing

**Channels contain threads, threads contain messages.** `sdk.conversations.create`
starts a thread; `sdk.messages.send` replies into one. Reaching for
`messages.send` to start a conversation is the most common early mistake.

**Ids come back from creates.** For catalog mutations, the SDK generates the row
ids before sending; server-side creation workflows return their allocated ids:

```typescript
const { conversationId, messageId } = await sdk.conversations.create({ ... });
const { id } = await sdk.canvases.create({ title: 'Design notes' });
const { id: channelId } = await sdk.channels.create({ ... });
const { id: ticketId } = await sdk.tickets.create({ ... });
```

You never construct these ids yourself, and you never see the participant ids,
mapping ids, or timestamps the underlying operations also require.

**File bytes use the API transport.** Pass browser `File` objects directly, or
use `{ file: blob, filename: 'report.pdf' }` in Node. Draft uploads return ids
that catalog-backed message and ticket methods can reference:

```typescript
const uploaded = await sdk.attachments.uploadDraft({
  channelId,
  files: [reportFile],
});

await sdk.messages.send({
  conversationId,
  content: 'Report attached.',
  attachmentIds: uploaded.uploadedAttachments
    .filter((item) => item.success)
    .map((item) => item.attachmentId),
});
```

**Some updates replace rather than patch.** These take the *complete* collection
and delete anything you leave out. Read the current set first:

- `sdk.boards.update({ stages })`
- `sdk.forms.update({ fields })`
- `sdk.boards.syncTransitions()`
- `sdk.recaps.saveSubscriptions()`

**Some operations toggle rather than set.** `channels.toggleStarred`,
`conversations.togglePin`, and `canvases.toggleStarred` flip the current value.
Read the current state first if you need a specific outcome.

**Errors are typed, and carry the server's code.** The class tells you the broad
shape; `serverCode` tells you exactly what happened. Two failures can share a
status — `forbidden` and `insufficient_scope` are both 403 — so branch on
`serverCode` when the distinction matters:

```typescript
import { AuthError, NotFoundError, RateLimitError, SdkError } from '@xyne/spaces-sdk';

try {
  await sdk.tickets.update({ ticketId, status: 'COMPLETED' });
} catch (err) {
  if (err instanceof NotFoundError) { /* gone, or not visible to this token */ }
  else if (err instanceof RateLimitError) { await wait(err.retryAfter); }
  else if (err instanceof SdkError && err.serverCode === 'insufficient_scope') {
    // A scope was never granted — retrying will not help.
  }
}
```

`serverCode` is one of the 17 codes defined by
[`@xyne/spaces-contract`](../xyne-spaces-contract) (`validation_failed`,
`insufficient_scope`, `idempotency_key_conflict`, `mixed_update_fields`,
`upstream_unavailable`, …). It is absent for purely local failures — `code` is
`network_error` or `timeout` in those cases.

**Support tickets are read-only here.** `sdk.supportTickets` is the desk view of
the same rows `sdk.tickets` writes to — reassigning or restaging a support ticket
goes through `sdk.tickets`.

**Collaborative canvases.** When a canvas has `isCollaborative` set, a realtime
server owns its content and writing through `canvases.update` is not a safe
read-modify-write. Save a version first.

## Coverage

The SDK's claim to completeness is checked, not asserted:

```bash
npm run coverage
```

```
catalog:  239 queries, 240 mutators (479 total)
exposed:  437
excluded: 42
accounted for: 479/479
```

Every catalog operation must be either exposed as a method or listed in
`src/exclusions.json` with a reason. A new backend operation fails the check until
someone decides which. The same check verifies that every referenced operation
actually exists and that every required argument is supplied — neither of which
TypeScript can catch, since the registries reference operations by string.

The 42 exclusions are superseded versions (`…V1` where `…V3` is exposed), plus one
the backend itself marks deprecated.

Operations absent from the catalog—creating channels and tickets and uploading
files—use the same direct API operation structure as search. See
[GAPS.md](./GAPS.md).

## Architecture

Each operation is declared once in `src/registry/` and surfaced by a method in
`src/resources/`:

```typescript
// registry/channels.ts — what it maps to
join: mutator<{ channelId: string }, void>('channel.joinChannel', {
  mapArgs: (args) => ({
    channelId: args.channelId,
    channelParticipantId: newId(),   // the plumbing callers never see
    channelUserStatusId: newId(),
    timestamp: now(),
  }),
}),

// resources/channels.ts — what you call
join(channelId: string): Promise<void> {
  return this.call(channelsOperations.join, { channelId });
}
```

Operations route to one of three backends, chosen per operation and invisible to
callers: OAuth-protected catalog queries for reads, OAuth-protected catalog
mutators for writes, and direct API calls for anything outside the catalog.
`sdk.claw` is the exception that is *not* invisible: it targets a different
service under `/claw/api/v1` through its own `HttpClient`, because it carries a
different credential.
Search established the direct API pattern; server-side channel/ticket creation
and multipart uploads now use it too. Moving an operation between transports
does not change the resource method callers use.

### The shared contract

[`@xyne/spaces-contract`](../xyne-spaces-contract) holds the facts this SDK and the
backend must agree on: the 17 error codes with their statuses and retryability, the
21 OAuth scope families, and the request/response schemas for the endpoints that
have them.

The SDK does **not** import it at runtime. The contract depends on zod; this package
ships zero runtime dependencies and has to load in a browser. Instead the agreement
is enforced at build time by `npm run contract-check`, which reads the contract and
backend sources and verifies:

1. every parameter `registry/search.ts` sends exists in `searchQuerySchema`
2. every `SearchOptions` key is a contract parameter, or is marked `@deprecated`
3. every field a direct-API input type declares is declared by its route's request
   body — otherwise the server silently ignores it
4. every field of an entity interface (`Channel`, `Ticket`, `Call`, …) is a real
   column on the table it mirrors
5. every error code the SDK branches on is one the contract defines

Catalog operations need none of this — their arguments are checked against the Zero
schemas by `npm run coverage`. This covers what that cannot see.

That check exists because its absence cost real bugs: the SDK once sent `sortBy`,
`sortOrder`, and `channelId` — none of which the server accepts. Because unknown
query parameters are *rejected* rather than ignored, every call that set one failed,
and the sort capability looked missing when it had shipped all along. The contract
had the correct `orderBy` the whole time; nothing was comparing the two.

## Development

```bash
npm run build           # compile to dist/
npm run typecheck       # tsc --noEmit
npm run coverage        # catalog coverage gate
npm run contract-check  # conformance with @xyne/spaces-contract
npm run verify          # all three
```
