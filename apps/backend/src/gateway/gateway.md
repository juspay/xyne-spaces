# Adding a provider to the gateway

The gateway carries everything between Spaces and an external app (a provider). Mirror, two-way channel sync, is the first use case on it. Slack is the first provider; `providers/slack/` is the reference to copy.

`core/` already does config storage, people's sign-in, errors and retries, provider events and the Spaces hooks; `useCases/mirror/` does Mirror's links, message map, locks, pausing and member sync. A provider supplies only what is specific to its API.

## Rules

- Only `re-exports.ts` imports from outside `gateway/`. Need repo code? Re-export it there. npm packages are imported directly.
- The rest of the repo imports the gateway only through `index.ts`.
- Don't change `core/` for one provider. If every provider needs something, add it to a base class.
- `core/` never imports from `useCases/`. Each use case implements `GatewayHandler` (`onProviderEvent`, `onSpacesMessageChanged`, `onSpacesMemberChanged`) and builds its own services and routes (`createMirror`); `index.ts` gives core the handlers and mounts the routes.
- `core/` is shared by every use case. A use case's controllers, services and guards live in `useCases/<name>/` (Mirror's in `useCases/mirror/`); repositories over the tables every use case shares stay in `core/repositories/`, and a use case's own stores (Mirror's Redis sync requests) in `useCases/<name>/repositories/`.

## Steps

1. Add the id to `ProviderId` in `core/types.ts`, e.g. `'slack' | 'teams'`.
2. Create `providers/<id>/` with the six files below.
3. Register it in `index.ts`:
   ```ts
   const teams = createServices(new TeamsProvider());
   const teamsMirror = createMirror(teams);
   gatewayRouter.use('/teams', teamsRoutes(teams, [teamsMirror.handler]));
   gatewayRouter.use('/teams', teamsMirror.router);
   // and add teamsMirror.handler to gatewayHooks
   ```
4. Point the provider's webhook at `<backend>/api/gateway/<id>/events`.

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

| Member                             | Does                                                                                                                                                                        |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`, `displayName`, `transformer` | Identity and the transformer instance                                                                                                                                       |
| `userMetadataKey`                  | Key on Spaces user metadata holding the provider user id, e.g. `slackId`                                                                                                    |
| `credentialsSchema`                | What an admin saves with `PUT /config`                                                                                                                                      |
| `validateCredentials()`            | Calls the provider; returns workspace id, name, bot user id, app id. Throws `VALIDATION_ERROR` if rejected                                                                  |
| `verifyRequest()`                  | Checks the webhook signature on the raw body; throws `INVALID_SIGNATURE`                                                                                                    |
| `parseEvent()`                     | `challenge` for setup handshakes, else `event` with the provider workspace id and a `ProviderEvent` (`null` to ignore)                                                      |
| `createApi()`                      | An `<Id>Api` for these credentials                                                                                                                                          |
| `isOwnMessage()`                   | True for Mirror's own posts (loop guard)                                                                                                                                    |
| `buildMessageSource()`             | Name, `sourceType` and credentials of the `ExternalSource` row that scopes the link's message map. `sourceType` picks the file-download auth in `ExternalAttachmentService` |
| `deskSourceName()`                 | The desk source that owns a channel, or `null` if the provider has no desk                                                                                                  |
| `legacyMessageSourceNames()`       | Optional: names older migrations gave a pair's history, so Mirror finds it too. Defaults to none                                                                            |
| `canAuthorizeUsers()`              | True when the config can sign people in, so their messages are posted as them                                                                                               |
| `buildUserAuthUrl()`               | The provider's sign-in page for a person's own token                                                                                                                        |
| `exchangeUserAuthCode()`           | Trades the sign-in code for the token, the person's provider id and their provider workspace                                                                                |
| `createUserApi()`                  | An `<Id>Api` acting as that person; their name and photo are never overridden                                                                                               |

## Posting as a person

A person signs in once per Spaces workspace (`GET /user/connect`, then the provider redirects to `/user/callback`). The token lands in `UserExternalToken` under the provider's CONNECTION sourceType, e.g. `slack-connection`, and only if it is for the configured provider workspace. Removing the config deletes that workspace's tokens.

- Outbound posts, edits and deletes use the sender's token when there is one. Otherwise the bot posts under the sender's provider name and photo (`findUser()`), or their Spaces ones when they have no provider account.
- A rejected token is dropped, and a person who can't reach the channel or didn't post that message falls back to the bot. These never pause a link.
- The provider echoes their post back as theirs. A lock per link and person is held until the post is mapped; an echo that arrives first gets 503 and is skipped on retry.
- Edits and deletes made in the provider to messages that came from Spaces are not copied back, so a change never bounces between the two.

## Sync requests (Mirror)

- A channel admin (`ChannelParticipant.role = ADMIN`) picks a provider channel and submits a request; an organisation admin approves or rejects it. Approving creates the link. Other members only see the status.
- Requests live in Redis with no expiry, like self-serve migration's jobs (`useCases/mirror/repositories/syncRequestRepository.ts`): `mirror:request:<id>`, an index per workspace `mirror:requests:<workspace>`, and a lock on the Spaces and the provider channel while one is pending. Statuses: `PENDING`, `APPROVED`, `REJECTED`, `CANCELLED`; a rejected or cancelled channel can be requested again.
- Approval re-runs the link checks as the requester. A failed check rejects the request with its reason; the requester is notified either way.
- The channel admin or an organisation admin can pause, resume and unlink.

## Data

The gateway stores its rows in `ExternalSource`, with `kind` set. Every older row has `kind = null` and is left alone. A future use case uses the same columns under its own sourceType.

| `kind`       | sourceType        | One per                                                                              | Holds                                                                                                                            |
| ------------ | ----------------- | ------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| `CONNECTION` | `<id>-connection` | provider workspace (name `<id>-connection-<workspace id>`); every use case shares it | The encrypted credentials; `externalIdentifier` is the provider workspace                                                        |
| `PAIR`       | `<id>-mirror`     | Mirror link (name `mirror-link-<connection id>-<channel id>`)                        | `parentId` → its `CONNECTION`, `externalIdentifier` (provider channel), `spacesId` (Spaces channel), `statusReason`, `createdBy` |

- PAIR rows go through `PairRepository`, scoped by the use case's sourceType suffix (`-mirror`); the use case builds each pair's unique name.
- Query the gateway's rows by `kind` and sourceType, and never set `channelId`, `ownerUserId` or `boardId` on them, so older code that filters on those never sees them.
- 1:1 is enforced by the database: the unique `name` allows one link per provider channel, and the unique `(spacesId, sourceType)` one per Spaces channel.
- The message map stays in `ExternalMessage`, under the channel's self-serve migration source (`buildMessageSource()`), so a migration and Mirror each skip what the other copied. Older migrations' rows (`legacyMessageSourceNames()`) are read too.

## Events

`parseEvent()` emits only `message_created`, `message_edited`, `message_deleted`, `member_joined` and `member_left`. In `ProviderMessage`, set `threadId` only on replies, and give files a URL the bot token can download.

## BaseApi

Implement `postMessage`, `updateMessage`, `deleteMessage`, `uploadFiles`, `findThreadParent`, `getChannel`, `listSharedChannels` (channels the user and the bot share), `listMembers`, `inviteMembers`, `removeMember`, `findUser`, `findUserIdByEmail` and `toGatewayError`. Names follow one rule: `find…` may return `null`, `get…` throws when missing, `list…` returns an array.

Run every call through `this.call()`: it maps failures with `toGatewayError()` and retries only `RATE_LIMITED`. Use `this.callIgnoring(fn, codes)` for errors that mean "already done", like already in channel.

| `toGatewayError()` returns | When                                     | Then                                    |
| -------------------------- | ---------------------------------------- | --------------------------------------- |
| `RATE_LIMITED`             | 429; set `retryAfterMs`                  | Retried up to 3 times                   |
| `PROVIDER_AUTH`            | Token revoked or invalid                 | Every link on the config pauses         |
| `CHANNEL_GONE`             | Channel deleted or archived, bot removed | That link pauses                        |
| `NOT_MESSAGE_AUTHOR`       | The token didn't post that message       | A person's edit falls back to the bot   |
| `PROVIDER_ERROR`           | Anything else; set `providerCode`        | Events answer 5xx, the provider retries |

Never retry anything else yourself: a timed-out post may already be sent.

## BaseTransformer

- `toSpaces(message, config)`: provider message → Spaces HTML.
- `toProvider(html, mentions)`: Spaces HTML → provider text. `mentions` maps Spaces user ids to provider user ids; anyone unmapped stays plain `@Name`.

## Provider app setup

- Webhook URL above, subscribed to message and channel-member events.
- Bot permissions to post (with a custom name and avatar), edit, delete and upload; read channel info and members; invite and remove members; read users and look them up by email.
- The bot is in every channel to sync.
- The admin also enters the app's name in the config; people's instructions use it.
- To let people post as themselves: the app's OAuth client id and secret in the config, user scope to post as the user, and redirect URL `<backend>/api/gateway/<id>/user/callback`.
