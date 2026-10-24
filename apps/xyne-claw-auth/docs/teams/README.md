# Microsoft Teams channel

Talk to a Claw agent from Teams: 1:1 chats with the bot, and @mentions in
group chats and channels (the answer goes into the thread that asked). Built on
the shared messaging core (`backend/src/surfaces/messaging`), so `/stop`,
`/status`, `/help`, `/new`, approvals, questions, the busy queue and rate
limits all behave as they do on WhatsApp.

Code: `backend/src/surfaces/teams/`. Ticket: XYNE-66904.

## Status and limits

- Behind `TEAMS_CHANNEL_ENABLED` (off by default). Off means the plugin is not
  registered: the webhook answers 404 and no Teams account starts.
- **Nobody can run an agent yet unless an identity row links them.** Identities
  are keyed by `<tenantId>:<entraObjectId>` from the signed activity, and
  linking them through Entra sign-in is XYNE-66905. Until then every sender gets
  a "not linked yet" reply. There is no self-service linking for Teams, and
  nothing a person types is used as their identity.
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
| `allowedTenantIds` | Only accept messages from these tenant GUIDs. Empty means any tenant the app is installed in, but identities are still required. |

An allowlist (`groupPolicy: "allowlist"`) matches whole conversation ids. Each
channel thread is its own id (`19:…@thread.tacv2;messageid=…`), so for channels
use `open`.

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

## 7. Link a tester (until XYNE-66905)

Without an identity row, every message gets the "not linked yet" reply, and
that reply is how you know signing, parsing and sending all work. To let one
test user run agents **in a local or test environment only**, an operator can
add the row the sign-in flow will write later. Use `pnpm db:studio` or the
same upsert `linkSenderToUser` in `surfaces/messaging/store.ts` does. Create a
`UserSurfaceIdentity` with:

- `surfaceId`: `teams`
- `surfaceUserId`: `<tenant GUID>:<user's Entra object id>`, both lowercase
- `orgId` and `surfaceWorkspaceId`: the org that owns the account
- `userId`: the tester's Spaces user id
- `status`: `ACTIVE`
- `linkedAt`: now

Never do this in production.

## Commands

The same as on WhatsApp: `/help`, `/status`, `/stop`, `/new`, `/agents`,
`/<agent-slug> <task>`, `/goal`, `/compact`, `/debug`. In a channel, put them
after the mention: `@Bot /status`.
