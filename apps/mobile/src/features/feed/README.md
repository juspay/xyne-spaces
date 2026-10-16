# Workspace feed prototype

Feed publishes text posts and selected conversation messages, including their
media, to the current workspace. This prototype uses the authenticated backend
and PostgreSQL. It does not publish to other workspaces or change access to
source chats.

## Mobile entry points

Open **Feed** in the classic bottom bar, or **menu → Feed** in the new
navigation. The classic bar's former Calls destination now appears under **More
→ Calls**. Choose **Enable on this device** if prompted. The `feed.prototype`
switch also appears in the feature-flag registry.

In either chat renderer, long-press a message and choose **Share to Feed**.
Select up to 10 messages, review the text and media, acknowledge workspace-wide
visibility, and publish. Feed supports original text posts, likes, comments,
editing your commentary/comments, deleting your content, and reporting posts.
Administrators can remove posts and comments.

Images render above the post text and open full screen. Multiple attachments
scroll horizontally. Video and audio download and play on tap; documents
download and open with the native file viewer. Each later quoted message keeps
its media above its text. Publishing copies source attachments; it never exposes
original storage paths or changes private-channel membership.

## Backend setup

The feed code now lives in this repository: routes and policy are under
`apps/backend/src/`, and the schema and additive migration are under
`apps/backend/prisma/`. The feed uses the existing authentication, workspace
membership, and conversation permissions; no new login system is introduced.

Apply the workspace-feed migration and generate the Prisma client using the
backend's normal development setup. Start the backend with
`WORKSPACE_FEED_ENABLED=true`. The migration adds only `non_zero.feed_*` tables.
Feed remains disabled server-side unless that variable is explicitly enabled.

Point the mobile development variant's `.env.dev` API URL at the local backend,
preserve its normal local authentication and Zero configuration, and restart
Metro with `npm run start:dev`. `config/loadLotusEnv.cjs` loads the variant
environment with override enabled, so a shell-only API URL override is not
sufficient. On a physical phone, use a reachable development-host address
instead of localhost, or use `adb reverse` for the local API and Zero ports.

No production database migration, rollout or app configuration change is part of
this branch.

## Verification

Mobile:

```sh
npm run typecheck
npx jest tests/unit/features/feed/composer.test.tsx --runInBand
```

Backend integration, from `apps/backend` with dependencies installed:

```sh
FEED_TEST_ADMIN_URL='postgresql://USER:PASSWORD@127.0.0.1:5433/postgres' node tests/feed.integration.mjs
```

The runner accepts only localhost, creates a disposable database, applies the
real migration, exercises the real Express routes and SQL, then drops its
database. Authentication identity, source conversations and object storage are
fixtures. It verifies tenant isolation, source permission checks, publication
acknowledgement and revisions, retry deduplication, media copying and range
requests, post/comment ownership, concurrent likes, reports, and removal. It
does not substitute for a signed-in device test against the complete backend and
storage services.

For the device demo, use two accounts in one local workspace. Publish a private
conversation containing an image and a video with account A. Account B should
see only the published excerpt/media, like it and comment, but still be unable
to open the source chat. Remove the post and refresh account B; the post and new
media requests must no longer be available. Also check dark mode, keyboard
handling, a failed publish retry, workspace switching and backgrounding
video/audio playback.

## Boundaries to review before production

- Feed is newest-first and polls every 10 seconds while active. No push
  notifications or ranked timeline.
- Publication supports 10 messages, 20 attachments, 100 MB per attachment and
  250 MB total. Large downloads on transports without native streaming retain
  the app's existing 16 MB JavaScript fallback limit.
- Post commentary and comments are plain text. Quoted HTML is converted to text
  on the server; source message IDs/revisions are revalidated before publishing.
- Video uses tap-to-download playback; separate poster thumbnails and
  transcoding are not implemented.
- Uploaded chat files are copied into feed-owned storage. Failed copies are
  cleaned up best-effort. Failed cleanup after deletion is logged and needs an
  operational retry job before a broad rollout.
- Deleting a source message does not delete its published snapshot.
  Administrative snapshot-removal workflows and retention policy need production
  review.
- Published post deletion blocks future media requests. It cannot retract bytes
  already downloaded or an already-open stream.
- Reporting is persisted and has an administrator-only API; a moderation queue
  UI, rate limits and audit integration remain production work.
- Backend routes use parameterized SQL in the non-Zero schema to avoid changing
  the generated shared client. A production deployment still needs native
  end-to-end verification.
