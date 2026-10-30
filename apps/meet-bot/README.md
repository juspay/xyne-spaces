# meet-bot — Xyne Automatic for Google Meet and Microsoft Teams

Joins a Google Meet (signed in as the bot's Google account with SSO) or a Microsoft
Teams meeting (as a guest) in a real (headed) Google Chrome, and streams the meeting's audio into a Xyne LiveKit room. The transcription
agent and the note-taker pipeline then put the transcript, summary and labels on the
call, exactly as for a Xyne recording.

```
Calls page: paste Meet link → POST /api/calls/meet-notetaker
  backend: creates Call (VIDEO, callOrigin MEET_LINK, SCHEDULED) → POST meet-bot /sessions
meet-bot: fresh Chrome → signs the bot account in with SSO → opens the link → joins (or waits in the lobby)
  → POST {callback}/status   joining | waiting_room | in_call | ended | failed
  → POST {callback}/livekit  once admitted: backend creates the room + agent, returns a token
  → mixes Meet's remote audio in the page and tags it with who is speaking
  → Node publishes each speaker as their own LiveKit participant, named after them
meeting ends / bot alone / removed → bot leaves → room closes → transcript + summary
```

## Platforms

Each platform is a join/leave flow (`src/platforms.ts`) plus a block of UI readers in
`src/inpage/meeting-capture.js` (`PLATFORMS`: in call, lobby, ended, who is speaking).
The audio capture itself is shared.

| | Google Meet | Microsoft Teams |
|---|---|---|
| Links | `meet.google.com/abc-defg-hij` | `teams.microsoft.com/l/meetup-join/…`, `teams.microsoft.com/meet/<id>?p=…`, `teams.live.com/meet/…` |
| Joins as | the bot's Google account (SSO), so it's let straight into internal meetings | a guest named `BOT_NAME`; someone lets it in from the lobby (or the meeting lets everyone in) |
| Flow | `meetPage.ts` | `teamsPage.ts`: launcher "Continue on this browser" → pre-join (name, camera and mic off) → Join now |
| People count | participant tiles | the People button (tiles undercount during screen share); 0 = unknown, so "alone" then relies on Teams' own message |

Teams won't show its join screen until it has a camera and mic, so Teams sessions get
Chrome's fake devices (`browser.ts`): a test-pattern camera and a mic playing silence,
granted without a prompt. The bot turns both off before joining, and even if one were
left on there is nothing real to send. Teams doesn't need SSO: guests can join unless
the organizer's tenant blocks anonymous users (then the bot reports `blocked`).

The link rules live in `src/meetingUrl.ts` and, for the backend and dashboard, in
`packages/shared/src/utils/meetingLinks.ts`: keep them in step.

## How it captures audio

`src/inpage/meeting-capture.js` runs inside the meeting page before Meet's own code. It wraps
`RTCPeerConnection` to keep every remote audio track Meet receives, mixes them with Web
Audio and hands 48 kHz mono PCM to Node (`window.__xyneAudio`, exposed by Playwright).
Node publishes it to LiveKit with the native SDK (`src/livekitPublisher.ts`, participant
"Google Meet"). LiveKit can't run inside Meet's page: Meet blocks injected `<script>` tags
and locks the browser objects livekit-client needs. Nothing plays through the speakers
(`MUTE_AUDIO=true`).

**Speaker names.** The page also watches Meet's participant tiles for the talking
animation (known animation classes first, otherwise the tile whose classes are
changing most) and tags each audio chunk with that person. `src/speakerRouter.ts`
sends each person's audio out as their own LiveKit participant, named after them
(token from `POST …/livekit {speaker}`), so the transcription agent labels lines with
real names. Meet's indicator trails the audio by ~0.3 s, so audio is credited to whoever
Meet shows ~3 chunks later; overlapping talk goes to the dominant speaker. Before anyone
is seen speaking, audio goes to the default "Google Meet" participant. The bot logs
`meeting_state` with the detected `speaker` whenever it changes.

## Google sign-in (SSO)

The bot signs in to its own Google account (e.g. `notetaker@juspay.in`, named "Xyne
Automatic") the way a company's identity provider signs its people in. Nobody types a
password, there is no saved login to expire, and every meeting signs in afresh in its
own browser, so meetings run side by side.

```
bot's Chrome → accounts.google.com (email) → Google: "this account uses SSO"
  → redirect to SSO_SIGN_IN_URL?SAMLRequest=…   ← answered inside the bot's Chrome
  → bot posts a signed SAML assertion for SSO_EMAIL to Google → signed in → the Meet
```

`src/sso.ts` answers the redirect with Chrome's request interception, so the sign-in URL
never has to exist on the network and nothing outside the bot's browser can get an
assertion. It only posts to Google, signs only `SSO_EMAIL`, and assertions expire in 5
minutes. The signing key never leaves the bot; Google only gets the certificate.

**One-time setup** (needs a Google Workspace super admin):

```bash
pnpm --filter meet-bot sso:setup   # makes sso/idp-key.pem + sso/idp-cert.pem, prints the admin steps
```

In admin.google.com:

1. Add the bot user (`notetaker@…`, name "Xyne Automatic") in an organizational unit
   or group of its own.
2. Security → Authentication → SSO with third-party IdP → **Add SAML profile**: IDP
   entity ID and sign-in page URL as printed (defaults:
   `https://sso.xyne-automatic.internal/saml/sign-in` for both), upload
   `sso/idp-cert.pem`.
3. **Manage SSO profile assignments**: assign the profile to the bot's unit/group
   **only**. Assigning it wider would send those users to the bot's sign-in.
4. Login challenges → Post-SSO verification for that unit: "not subject to
   additional verification checks", so Google never asks the bot to verify.

Then set `SSO_EMAIL` in `apps/meet-bot/.env` and check it with
`pnpm --filter meet-bot sso:check` (signs in, no meeting). The bot validates the key
and certificate at startup and refuses to start with a broken pair.

If sign-in fails, the call shows "the bot couldn't sign in to Google" and the bot logs
`session_failed` with `reason: sso_failed` and what Google showed: a password page (the
profile isn't assigned to the account), a verification challenge (step 4), a CAPTCHA
(too many sign-ins from one network), or Google rejecting the assertion (certificate
or entity ID don't match the profile).

Keep `sso/idp-key.pem` secret: whoever has it can sign in as the bot. To rotate, make
a new pair, upload the new certificate to the profile, then deploy the new key.

## Run it locally (docker, same image as production)

```bash
# 1. Config: same MEET_BOT_API_KEY as the backend's .env.local, plus SSO_EMAIL
cp apps/meet-bot/.env.example apps/meet-bot/.env
pnpm --filter meet-bot sso:setup        # keys in apps/meet-bot/sso (mounted read-only)

# 2. Start it with the rest of the infra: pick "Meet Notetaker" (it brings in
#    livekit + transcription-agent)
pnpm run services:raw
```

Backend `.env.local`: `MEET_BOT_URL=http://localhost:3010` and the same `MEET_BOT_API_KEY`.
The Calls page then offers "Add notetaker to a Google Meet". `docker logs -f
xyne-spaces-meet-bot` shows each step (`sso_signed_in`, `session_status`,
`meeting_state`). The container reaches the backend and LiveKit through
`BACKEND_URL_OVERRIDE` / `LIVEKIT_URL_OVERRIDE` (set in docker-compose.dev.yml), because
the URLs the backend hands out say `localhost`. Source changes reload (`src/` is
mounted); a dependency change needs `docker compose -f docker-compose.dev.yml build meet-bot`.

Outside docker (debugging on the Mac): `pnpm --filter meet-bot dev`; Chrome then opens
as a normal window you can watch. `pnpm --filter meet-bot try <meet-link>` runs one
meeting without the backend.

No SSO yet? Set `ALLOW_GUEST_JOIN=true`: the bot joins as a guest named `BOT_NAME` and
the host has to admit it (Google often refuses guest bots outright).

## The image

`Dockerfile` installs a browser (Google Chrome on amd64, Chromium on arm64: Google ships
no Linux arm64 Chrome), Xvfb (virtual screen; Meet and Google sign-in refuse headless
Chrome) and PulseAudio (a null sink, so the browser has an audio device and decodes the
meeting). Each meeting is one browser (~0.25–1 CPU, ~1 GB, `shm_size` ≥ 1 GB);
`MAX_CONCURRENT_SESSIONS` caps them. Nothing is kept on disk: give it `SSO_EMAIL` and
the key and certificate as secrets (`SSO_PRIVATE_KEY` / `SSO_CERTIFICATE`, or `*_FILE`).

## API

| | |
|---|---|
| `GET /health` | `{ ok, activeSessions, maxSessions, sso }` |
| `POST /sessions` | `{ sessionId, meetingUrl, callbackUrl }` → 202. 409 if running, 503 at capacity |
| `GET /sessions/:id` | current status |
| `DELETE /sessions/:id` | leave the meeting |

All but `/health` need `x-api-key: MEET_BOT_API_KEY`; the bot sends the same key on callbacks.
