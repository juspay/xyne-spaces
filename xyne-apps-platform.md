# Xyne Apps — the external app platform

Reference notes on how third-party apps are built, authenticated, installed and
distributed in Xyne Spaces, and how that relates to the newer **artifact apps**
(agent-generated React apps rendered in-browser).

> Scope: read-only exploration of `apps/backend/src/apps/**` and the `Apps*`
> Prisma models. Nothing here is a proposal.

---

## The short version

It is a **Slack-compatible app API**. The endpoints are literally Slack Web API
method names, and there is a `platform-adapters/slack` directory, so an existing
Slack app ports over with little more than a base-URL change.

An app is code the developer hosts themselves. It authenticates to Spaces with a
JWT signed by its own signing secret, calls REST endpoints to post messages and
read history, and receives events on a webhook.

---

## Data model (`apps/backend/prisma/schema.prisma`)

| Model | Table | Purpose |
|---|---|---|
| `Apps` | `apps` | The app definition: `name`, `createdBy`, `orgId`, `scope`, `version`, `webhookUrl`, `signingSecret` (encrypted at rest) |
| `InstalledApps` | `installed_apps` | One row per (`appId`, `userId`) install. Carries its own `webhookUrl` and `version` |
| `AppCommand` | `app_commands` | Slash commands / shortcuts: `commandName`, `commandType`, `commandAccessibility`, `isForThread`, `isForChat` |
| `InstalledAppPermission` | — | Permissions actually granted on an install |
| `InstalledAppCommand` | — | Commands enabled on an install |
| `AppIncomingWebhook` | `app_incoming_webhooks` | Channel-scoped inbound webhook with its own `secret`, revocable (`revokedAt`/`revokedBy`) |
| `AppPermission` | `app_permissions` | Permissions an app declares |

Every table carries the standard denormalized `workspaceId` tenant key.

---

## Authentication

`apps/backend/src/apps/middelware/authenticator.ts` (note the spelling — it is
`middelware` on disk).

1. App sends `Authorization: Bearer <JWT>`.
2. Middleware **decodes** the token to learn which app is calling.
3. Loads that `Apps` row and **decrypts** its `signingSecret`.
4. **Verifies** the JWT signature against that secret — *"this is where trust is
   established"*.

Rotation is supported: `POST /api/apps/regenerate-jwt/:appId` and
`POST /api/apps/signing-secret/:appId`.

Note the asymmetry worth remembering: the app→Spaces direction is JWT-signed,
while inbound webhooks are authenticated by a **secret in the URL path**
(`/webhooks/:workspaceId/:appId/:secret`).

---

## API surface (`/api/apps`, from `apps/backend/src/apps/routes/`)

**Messaging & reads** — Slack-shaped:
```
POST /postMessage        POST /updateMessage      POST /schedule
POST /agentProgress      GET  /channelHistory     GET  /conversationReplies
GET  /conversationAttachments
```

**Lifecycle & distribution:**
```
POST /create                     mint an app + signing secret
POST /install/:appId             install for a user
POST /promote/:appId             ORG → GLOBAL (marketplace), admin-gated
POST /configureWebhook/:appId    set the outbound webhook
POST /upload-picture/:appId
GET  /bot-channels/:appId
```

**Per-install configuration:**
```
PATCH /installed/:installedAppId
GET   /installed/:installedAppId/permissions
POST  /installed/:installedAppId/permissions
POST  /installed/:installedAppId/permissions/activate
GET   /installed/:installedAppId/commands
```

**Inbound webhooks** — generic plus prebuilt provider shapes:
```
POST /webhooks/:workspaceId/:appId/:secret
POST /webhooks/sentinel|sns|pingdom|gcp/:workspaceId/:appId/:secret
POST /incoming-webhooks            GET /incoming-webhooks/:installedAppId
PATCH /incoming-webhooks/:webhookId
```

Other route files in the same directory expose `channel`, `chat`, `ticket`,
`user`, `usergroups`, `files`, `email` and `calls` surfaces.

---

## Distribution

`Apps.scope` is `ORG` or `GLOBAL`. `POST /api/apps/promote/:appId` moves an app
from org-private to the global marketplace and is admin-gated.

The browse/install UI is `apps/dashboard/src/routes/AppsScreen/AppsScreen.tsx`,
mounted at **`/:workspaceId/apps`**, with Installed / Org / Marketplace tabs. It
reads through Zero queries (`getWorkspaceInstalledApps`, `getOrgApps`,
`getMarketplaceApps`) and uses REST via `services/Apps/appsService.ts` for
actions Zero cannot express (install, promote, secrets, picture upload).

> **Route collision:** `/:workspaceId/apps` belongs to *this* platform. The
> artifact-app gallery therefore lives at `/:workspaceId/ai/library?tab=apps`.

---

## Not to be confused with

- **`packages/kata-sdk`** (`@xyne/kata-sdk`) — the *sandbox* client used by
  claw's `sandbox-*` tools: `KataClient`, `Session`, `CommandsModule`,
  `FilesystemModule`. Nothing to do with Xyne Apps.
- **`origin/feature/spaces-sdk`** — an unexplored branch that may hold a
  packaged client for this API.

---

## Xyne Apps vs artifact apps

Two different things that both ended up called "apps":

| | **Xyne Apps** | **Artifact apps** |
|---|---|---|
| Author | A developer, outside this repo | Anyone, by asking an agent in chat |
| Runs | On the developer's own server | Sandpack iframe in the browser |
| Talks to Spaces | Yes — JWT-authenticated REST + webhooks | No — data is inlined at generation time |
| Identity | Own app identity + granted permissions | None; renders as the viewing user |
| Distribution | Install per user; promote ORG → GLOBAL | Publish to workspace |
| Cost to create | Write and host a service | One sentence in chat |

Xyne Apps is the **integration** story (real backend, real credentials, write
access). Artifact apps are the **no-code** story (describe it, get a UI).

**Where they would meet.** Artifact apps currently inline a snapshot of data,
which means publishing one exposes the author's data view to every viewer. The
natural fix is for an artifact to resolve data per-viewer at render time. If that
happens, `AppPermission` / `InstalledAppPermission` already model
"this app may read these things for this user" — worth reusing rather than
inventing a parallel permission vocabulary. See also `POST /api/query/claw`
(`apps/backend/src/app.ts:324`), a read-only, ACL-enforced query gateway
(`findMany`/`count` only, ~35 allowlisted models, `MAX_TAKE = 1000`).
