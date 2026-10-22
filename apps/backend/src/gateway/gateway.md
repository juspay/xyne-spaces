# Adding a provider to the gateway

The gateway carries everything between Spaces and an external app (a provider). Mirror, two-way channel sync, is the first use case on it. Slack is the first provider; `providers/slack/` is the reference to copy.

`core/` already does config storage, people's sign-in, errors and retries, provider events and the Spaces hooks; `useCases/mirror/` does Mirror's links, message map, locks, pausing and member sync. A provider supplies only what is specific to its API.

## Rules

- Only `re-exports.ts` imports from outside `gateway/`. Need repo code? Re-export it there. npm packages are imported directly.
- The rest of the repo imports the gateway only through `index.ts`.
- Don't change `core/` for one provider. If every provider needs something, add it to a base class.
- `core/` never imports from `useCases/`. Each use case implements `GatewayHandler`: `onProviderEvent`, plus `onSpacesMessageChanged`, `onSpacesMemberChanged` and `runJob` only if it needs them, and builds its own services and routes (`createMirror`); `index.ts` gives core the handlers and mounts the routes.
- Use cases never see provider secrets. They get a `ProviderConnection` (`ConfigService.getConnectionBy…()`, or the one passed to `onProviderEvent`): ids, workspace, app name, a ready `api` and `toSpaces()`. Only core and the provider read `credentials`.
- `core/` is shared by every use case. A use case's controllers, services and guards live in `useCases/<name>/` (Mirror's in `useCases/mirror/`); repositories every use case shares (connections, pairs, people's tokens) stay in `core/repositories/`, and a use case's own stores in `useCases/<name>/repositories/` (Mirror's message map and Redis sync requests).

## Steps

1. Add the id to `ProviderId` in `core/types.ts`, e.g. `'slack' | 'teams'`.
2. Create `providers/<id>/` with the six files below.
3. Register it in `index.ts`:
   ```ts
   const teams = createServices(new TeamsProvider());
   const teamsMirror = createMirror(teams);
   gatewayRouter.use('/teams', teamsRoutes(teams, [teamsMirror.handler]));
   gatewayRouter.use('/teams', teamsMirror.router);
   // and add teamsMirror.handler to gatewayHooks and jobs.register()
   ```
4. Point the provider's webhook at `<backend>/api/gateway/<id>/events`.
5. Add the handler's name (e.g. `teams-mirror`) to `GATEWAY_WORKER_HANDLERS` on the worker that should run its jobs.

## The six files

| File                 | Holds                                                  |
| -------------------- | ------------------------------------------------------ |
| `<id>Provider.ts`    | `extends BaseProvider<Credentials>`                    |
| `<id>Api.ts`         | `extends BaseApi`: the provider's API calls            |
| `<id>Transformer.ts` | `extends BaseTransformer`: provider text ⇄ Spaces HTML |
| `<id>Routes.ts`      | The same endpoints as `slackRoutes.ts`, wiring only    |
| `<id>Utils.ts`       | Pure helpers: signature check, webhook parsing         |
| `types.ts`           | Credentials zod schema and webhook payload shapes      |

## BaseProvider

| Member                             | Does                                                                                                                   |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `id`, `displayName`, `transformer` | Identity and the transformer instance                                                                                  |
| `userMetadataKey`                  | Key on Spaces user metadata holding the provider user id, e.g. `slackId`                                               |
| `credentialsSchema`                | What an admin saves with `PUT /config`                                                                                 |
| `validateCredentials()`            | Calls the provider; returns workspace id, name, bot user id, app id. Throws `VALIDATION_ERROR` if rejected             |
| `verifyRequest()`                  | Checks the webhook signature on the raw body; throws `INVALID_SIGNATURE`                                               |
| `parseEvent()`                     | `challenge` for setup handshakes, else `event` with the provider workspace id and a `ProviderEvent` (`null` to ignore) |
| `createApi()`                      | An `<Id>Api` for these credentials                                                                                     |
| `isOwnMessage()`                   | True for the app's own posts (loop guard)                                                                              |
| `buildUserAuthUrl()`               | The provider's sign-in page for a person's own token                                                                   |
| `exchangeUserAuthCode()`           | Trades the sign-in code for the token, the person's provider id and their provider workspace                           |
| `createUserApi()`                  | An `<Id>Api` acting as that person; their name and photo are never overridden                                          |

## Posting as a person

A person signs in once per Spaces workspace (`GET /user/connect`, then the provider redirects to `/user/callback`). The token lands in `UserExternalToken` under the provider's CONNECTION sourceType, e.g. `slack-connection`, and only if it is for the configured provider workspace. Removing the config deletes that workspace's tokens.

- Outbound posts, edits and deletes use the sender's token when there is one. Otherwise the bot posts under the sender's provider name and photo (`findUser()`), or their Spaces ones when they have no provider account. A message with files is one post with the text and files; from the bot, its text starts with the sender's name (`prefixAuthor()`), since files can't carry a custom name.
- A rejected token is dropped, and a person who can't reach the channel or didn't post that message falls back to the bot. These never pause a link.
- The provider echoes their post back as theirs. A lock per link and person is held until the post is mapped; an echo that arrives first gets 503 and is skipped on retry.
- Edits and deletes made in the provider to messages that came from Spaces are not copied back, so a change never bounces between the two.

## Sync requests (Mirror)

- A channel admin (`ChannelParticipant.role = ADMIN`) picks a provider channel and submits a request; an organisation admin approves or rejects it. Approving creates the link. Other members only see the status.
- Requests live in Redis with no expiry, like self-serve migration's jobs (`useCases/mirror/repositories/syncRequestRepository.ts`): `mirror:request:<id>`, an index per workspace `mirror:requests:<workspace>`, and a lock on the Spaces and the provider channel while one is pending. Statuses: `PENDING`, `APPROVED`, `REJECTED`, `CANCELLED`; a rejected or cancelled channel can be requested again.
- Approval re-runs the link checks as the requester. A failed check rejects the request with its reason; the requester is notified either way.
- The channel admin or an organisation admin can pause, resume and unlink.

## Data

The gateway stores its rows in `ExternalSource`, with `recordType` set. Every older row has `recordType = null` and is left alone. A future use case uses the same columns under its own sourceType.

| `recordType` | sourceType        | One per                                                                              | Holds                                                                                                                                                                               |
| ------------ | ----------------- | ------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CONNECTION` | `<id>-connection` | provider workspace (name `<id>-connection-<workspace id>`); every use case shares it | The encrypted credentials, the admin's `description`; `externalIdentifier` is the provider workspace                                                                                |
| `PAIR`       | `<id>-mirror`     | Mirror link (name `mirror-link-<connection id>-<channel id>`)                        | `recordParentId` → its `CONNECTION`, `externalIdentifier` (provider channel), `spacesIdentifier` (Spaces channel), `recordState` (why it stopped, e.g. `CHANNEL_GONE`), `createdBy` |

- PAIR rows go through `PairRepository`, scoped by the use case's sourceType suffix (`-mirror`); the use case builds each pair's unique name.
- Query the gateway's rows by `recordType` and sourceType. A use case may set `channelId` on its PAIR when the Spaces side is a channel (Mirror does); every older lookup by `channelId` also filters by sourceType or name, so none of them match it. Never set `ownerUserId` or `boardId`.
- One link per provider channel: the unique `name`. One link per Spaces channel: links are made only on approval, one request per channel can be pending, and approval checks again. `(workspaceId, spacesIdentifier)` is indexed, since every Spaces message checks it.
- The message map stays in `ExternalMessage`, under the channel's self-serve migration source, so a migration and Mirror each skip what the other copied; older migrations' rows are read too. Mirror owns those names per provider in `useCases/mirror/messageSources.ts`, so a provider never knows about them. Those rows hold no token: incoming files are downloaded by the provider's `api`.

## Jobs

`core/queue/gatewayQueue.ts` gives each handler that implements `runJob()` its own Bull queue, `gateway-<handler name>` (Mirror on Slack: `gateway-slack-mirror`). A handler with no `runJob()` never touches it. API pods add jobs; a worker process runs the handlers listed in `GATEWAY_WORKER_HANDLERS`, e.g. `slack-mirror` (`generic-worker` in the cluster, `pnpm dev:worker` locally), so each use case can run in its own deployment.

- Queued: every Spaces message change, and provider messages with files. Messages without files and member changes still run inside the request.
- An edit, delete or reply whose message is still queued is queued too, and waits for it.
- Retries: 3 s, 1 min, 5 min, 2 h, 6 h, 12 h for `RATE_LIMITED`, `LOCK_HELD`, `PROVIDER_ERROR` and unexpected errors. Other gateway errors fail at once.
- A job is removed when it succeeds. One that fails every retry is kept 7 days: `GET /jobs`, `POST /jobs/:handler/:id/retry`, `DELETE /jobs/:handler/:id` (workspace admins).
- No double posts: a job saves its progress before posting. A retry first looks for the earlier post: `findFileMessage()` for files, `findPostedMessage()` otherwise (the caller's `origin` tag in the post's metadata, e.g. Mirror's `xyne_mirror`, or author and text for a person's token).
- Files go one at a time, each uploaded file id is saved, and on the last try a file that still fails becomes a "📎 name (couldn't copy)" line.

## Events

`parseEvent()` emits only `message_created`, `message_edited`, `message_deleted`, `member_joined` and `member_left`. In `ProviderMessage`, set `threadId` only on replies, and give files a URL the bot token can download.

## BaseApi

`<Id>Api extends BaseApi` implements `toGatewayError` and the groups the provider supports. Its provider declares that type: `class SlackProvider extends BaseProvider<SlackCredentials, SlackApi>`.

| Group          | Methods                                                                                                                  |
| -------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `MessagingApi` | `postMessage`, `updateMessage`, `deleteMessage`, `findPostedMessage`, `findThreadParent`                                 |
| `FileApi`      | `downloadFile` (with the provider's own token), `uploadFile`, `shareFiles`, `findFileMessage`                            |
| `ChannelApi`   | `getChannel`, `listSharedChannels` (channels the user and the bot share), `listMembers`, `inviteMembers`, `removeMember` |
| `DirectoryApi` | `findUser`, `findUserIdByEmail`                                                                                          |

A use case asks for the groups it needs: Mirror takes `ProviderServices<MirrorApi>`, all four, so `createMirror()` on a provider missing one doesn't compile. Never stub a method a provider can't support; leave its group out. Names follow one rule: `find…` may return `null`, `get…` throws when missing, `list…` returns an array.

Run every call through `this.call()`: it maps failures with `toGatewayError()` and retries only `RATE_LIMITED`. Use `this.callIgnoring(fn, codes)` for errors that mean "already done", like already in channel.

| `toGatewayError()` returns | When                                     | Then                                  |
| -------------------------- | ---------------------------------------- | ------------------------------------- |
| `RATE_LIMITED`             | 429; set `retryAfterMs`                  | Retried up to 3 times                 |
| `PROVIDER_AUTH`            | Token revoked or invalid                 | Every link on the config pauses       |
| `CHANNEL_GONE`             | Channel deleted or archived, bot removed | That link pauses                      |
| `NOT_MESSAGE_AUTHOR`       | The token didn't post that message       | A person's edit falls back to the bot |
| `NOT_PERMITTED`            | The token lacks a scope                  | A person's call falls back to the bot |
| `PROVIDER_ERROR`           | Anything else; set `providerCode`        | Events answer 5xx; jobs retry         |

Never retry anything else yourself: a timed-out post may already be sent.

## BaseTransformer

- `toSpaces(message, config)`: provider message → Spaces HTML.
- `toProvider(html, mentions)`: Spaces HTML → provider text. `mentions` maps Spaces user ids to provider user ids; anyone unmapped stays plain `@Name`.
- `prefixAuthor(name, text)`: the sender's name in front of a bot post that can't show it otherwise.

## Provider app setup

- Webhook URL above, subscribed to message and channel-member events.
- Bot permissions to post (with a custom name and avatar), edit, delete and upload; read channel info and members; invite and remove members; read users and look them up by email.
- The bot is in every channel to sync.
- The admin also enters the app's name in the config; people's instructions use it.
- The app's OAuth client id and secret go in the config with the bot token, plus user scopes to post and upload files as the user and the redirect URL `<backend>/api/gateway/<id>/user/callback`, so people can post as themselves.
- Slack: turn on Event Subscriptions → Delayed Events, so Slack keeps retrying missed events for 24 hours.
