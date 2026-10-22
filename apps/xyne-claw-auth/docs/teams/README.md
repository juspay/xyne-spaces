# Microsoft Teams channel

Talk to a Claw agent from Teams: 1:1 chats with the bot, and @mentions in
group chats and channels (the answer goes into the thread that asked). Built on
the shared messaging core (`backend/src/surfaces/messaging`), so `/stop`,
`/status`, `/help`, `/new`, approvals, questions, the busy queue and rate
limits all behave as they do on WhatsApp.

Code: `backend/src/surfaces/teams/`. Tickets: XYNE-66904 (channel),
XYNE-66905 (identity and tenant binding).

## Status and limits

- Behind `TEAMS_CHANNEL_ENABLED` (off by default). Off means the plugin is not
  registered: the webhook answers 404, no Teams account starts, and the tenant
  API below does not exist.
- **Only bound tenants are answered.** An org admin binds each Microsoft
  tenant (step 3b). A message from any other tenant is dropped with no reply,
  before anything is stored or looked up. One tenant belongs to one org.
- **People are linked by what Microsoft says, never by what they type.**
  Identities are keyed by `<tenantId>:<entraObjectId>` from the signed
  activity. The first time someone writes, the bot asks Microsoft Graph for
  that object id's `userPrincipalName` and links them to the user of the
  bound org with that email. Guests and disabled accounts are never linked.
  Anyone who cannot be matched gets a reply that explains how linking works.
- The agent invoke ACL (agent privacy whitelist) is the same check WhatsApp
  uses (`surfaces/messaging/dispatch.ts`, `buildChannelRun`).
- Not yet: Adaptive Cards (XYNE-66906; questions and approvals arrive as
  numbered text), files (XYNE-66907; a file arrives as "sent a file that could
  not be read"), proactive messages (XYNE-66908).

## 1. Register the bot in Azure

1. In the Azure portal, create an **Azure Bot** resource.
   - Type of app: **Multi Tenant** if the bot will be installed in tenants
     other than your own, otherwise **Single Tenant**. Microsoft has been
     retiring new multi-tenant bot registrations, so check what the portal
     offers. For a single-tenant bot, set `appTenantId` on the account (step 3).
   - Creation type: create a new Microsoft App ID.
2. Under **Configuration**:
   - Note the **Microsoft App ID**.
   - **Manage Password**, then add a client secret and note its **Value**.
   - Leave **Messaging endpoint** empty for now; you set it in step 4.
3. Under **Channels**, add **Microsoft Teams** and accept the terms.
4. Open the App ID's **App registration** (Entra ID → App registrations), then
   **API permissions → Add a permission → Microsoft Graph → Application
   permissions → `User.Read.All`**. This is how the bot learns who a sender is
   (their `userPrincipalName`). It is an application permission, so it needs
   **admin consent in every tenant whose people will use the bot**:
   - your own tenant: **Grant admin consent** on the same page;
   - another tenant (multi-tenant bot): a Global Administrator or Privileged
     Role Administrator of that tenant opens
     `https://login.microsoftonline.com/<their tenant id>/adminconsent?client_id=<Microsoft App ID>`
     and accepts. (Not yet tried against a real second tenant; confirm the
     URL on the first multi-tenant rollout.)

   Without consent nobody from that tenant can be linked: they get the link
   prompt, and claw-auth logs `directory lookup failed … tenant=<id>`.

## 2. Turn the channel on

Set `TEAMS_CHANNEL_ENABLED=true` on claw-auth and restart it. The startup log
says `Microsoft Teams channel enabled`. The `surfaces` row comes from the
`20261022200000_teams_surface` migration.

## 3. Create the account in Xyne

As an org admin (the session cookie or bearer token of a Spaces login), call:

```bash
# Create the account. agentSlug is the agent that answers by default.
curl -X POST "$CLAW/claw/api/v1/surfaces/teams/accounts" \
  -H 'content-type: application/json' --cookie "$SESSION" \
  -d '{"label":"Teams","agentSlug":"<agent-slug>","channel":{}}'
# → { account: { id, …, webhookUrl } }

# Store the credentials and start it.
curl -X POST "$CLAW/claw/api/v1/surfaces/teams/accounts/<id>/login" \
  -H 'content-type: application/json' --cookie "$SESSION" \
  -d '{"secrets":{"app-id":"<Microsoft App ID>","app-password":"<client secret value>"}}'

# Answer in channels and group chats. The default group policy is an empty
# allowlist, which ignores every group. requireMention stays on.
curl -X PATCH "$CLAW/claw/api/v1/surfaces/teams/accounts/<id>" \
  -H 'content-type: application/json' --cookie "$SESSION" \
  -d '{"groupPolicy":"open"}'
```

Optional `channel` settings:

| key | meaning |
| --- | --- |
| `appTenantId` | Tenant GUID of a **Single Tenant** registration. Omit it for a multi-tenant one. |

An allowlist (`groupPolicy: "allowlist"`) matches whole conversation ids. Each
channel thread is its own id (`19:…@thread.tacv2;messageid=…`), so for channels
use `open`.

## 3b. Bind your Microsoft tenant to the org

Find the tenant id in Entra ID → **Overview → Tenant ID** (or in the
claw-auth log line `message from a tenant not bound to this org … tenant=<id>`
after a first message). Then, as an org admin:

```bash
# Bind. 201 when new, 200 when already bound to this org,
# 409 when another org holds it (that org has to unbind it first).
curl -X POST "$CLAW/claw/api/v1/surfaces/teams/accounts/<id>/tenants" \
  -H 'content-type: application/json' --cookie "$SESSION" \
  -d '{"tenantId":"<tenant GUID>"}'

# List the org's bound tenants.
curl "$CLAW/claw/api/v1/surfaces/teams/accounts/<id>/tenants" --cookie "$SESSION"

# Unbind. Also removes every Teams link of that tenant's people in the org.
curl -X DELETE "$CLAW/claw/api/v1/surfaces/teams/accounts/<id>/tenants/<tenant GUID>" --cookie "$SESSION"
```

A binding belongs to the org, not to the account it was made through. Binding
and unbinding are written to the agent audit log (`TEAMS_TENANT_BOUND`,
`TEAMS_TENANT_UNBOUND`), as are links (`CHANNEL_IDENTITY_LINKED`) and admin
unlinks (`CHANNEL_IDENTITY_UNLINKED`).

## 4. Point the bot at Xyne

Copy the account's `webhookUrl`
(`<selfUrl>/claw/api/v1/surfaces/teams/webhook/<accountId>`) into the Azure
Bot's **Configuration → Messaging endpoint** and save. It has to be HTTPS and
reachable from the internet.

## 5. Build the Teams app package

1. Copy `manifest.template.json` to `manifest.json` and fill in the
   placeholders. `{{MICROSOFT_APP_ID}}` goes in both `id` and `bots[0].botId`.
2. Add two icons next to it: `color.png` (192×192) and `outline.png` (32×32,
   white on a transparent background).
3. Zip the three files with no enclosing folder: `zip teams-app.zip manifest.json color.png outline.png`.

## 6. Install it in a tenant

- **Try it yourself:** in Teams, go to **Apps → Manage your apps → Upload an app →
  Upload a custom app** and pick the zip. Custom app upload has to be allowed
  for you in the Teams admin center (**Teams apps → Setup policies**).
- **Whole tenant:** a Teams admin uploads the zip in the Teams admin center
  (**Teams apps → Manage apps → Upload new app**), allows it, and optionally
  pins or installs it through a setup policy.
- **In a channel:** open the team, choose **Apps → Add an app to this team**
  (or **+** on a channel), and pick the app. In channels and group chats the bot
  only sees messages that @mention it.

## 7. How people get linked

Nobody has to do anything. When someone from a bound tenant first messages
the bot, claw-auth reads their directory entry through Graph and links them
to the org user whose email equals their `userPrincipalName`
(case-insensitive). From then on, their messages run as that user.

Someone is not linked, and gets the link prompt, when:

- no user of the org has that email (they have never signed in to Xyne with
  their work email), or two users do;
- they are a guest in the tenant, or their account is disabled;
- the tenant has not consented to `User.Read.All` (step 1.4);
- they are a federated or anonymous participant with no Entra object id.

Once the cause is fixed, the next message links them (one directory lookup
per person per minute at most). An admin unlink
(`DELETE /accounts/<id>/identities/<tenantId>:<objectId>`) only forces a fresh
lookup on the next message; to keep a person out, remove their Xyne access or
unbind the tenant.

## Commands

The same as on WhatsApp: `/help`, `/status`, `/stop`, `/new`, `/agents`,
`/<agent-slug> <task>`, `/goal`, `/compact`, `/debug`. In a channel, put them
after the mention: `@Bot /status`.
