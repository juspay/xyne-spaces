# In-call experience (mobile)

The live call screen (`src/screens/NativeCallScreenV2.tsx`) is a thin
orchestrator: it owns the `roomMachine` state, navigation / keyguard handling
and the host actions, and hands everything visual to `src/components/call`. The
design language is the dashboard's call UI (Material-dark palette, blurred-photo
camera-off tiles, ringing tile, network toast) combined with WhatsApp / FaceTime
interaction patterns (immersive 1:1 video, draggable self-view, auto-hiding
controls, ringing avatar).

Tokens live in `callTheme.ts`. Chips, badges, header buttons, the control bar
and the waiting card share one frosted surface, `GlassPanel` (real liquid glass
on iOS 26; elsewhere the app's usual BlurView + dark tint + hairline ring, the
mobile equivalent of the dashboard's `backdrop-blur` + `ring-white/15`). Android
can't blur a native video surface, so it gets a denser tint. The call surface is
**always dark**, independent of the app theme — do not read uniwind variables
inside it.

Rings on **round** surfaces (avatars, the header's `GlassIconButton`s) are drawn
with `CircleRing`, never `borderWidth`: on Android a rounded border is stroked
inside a hard-edged clip, which leaves a thin translucent ring brighter at the
top, bottom, left and right than on the curve between — it reads as four dots.

---

## 1. Layers

```
CallScreenLayout            safe-area maths, chrome show/hide animation, z-order
├─ CallStage                LiveKit tracks + Zero roster → tiles
│  └─ StageCanvas           measures itself, computeStageLayout, hosts tiles
│     └─ AnimatedTileFrame  animates one tile's frame; PiP drag + corner snap
├─ CallHeader               title, status / timer, minimise, add people, flip camera
├─ ConnectionBanner         "Reconnecting…", "Your connection is unstable"
├─ WaitingForOthers         alone in a link / instant call → share link
├─ CallControls             audio · camera · mic · screen share · more · end
└─ sheets                   CallMoreSheet (Xyne Automatic · add people · chat ·
                            share link · participants · flip camera · audio output),
                            ParticipantsDrawer, InviteUserDrawer, EndCallDrawer,
                            AiControlRequestSheet
```

Screen share is a main-bar toggle, same footing as mic/camera. Xyne Automatic's
toggle lives in the More sheet instead — it's reached for far less often, and
the sheet's tile still carries its full state: purple + "Active" while you
control it, amber + the controller's name while someone else does, with the same
notification dot the bar version had.

Before the room is live, `CallConnectingView` shows the callee's ringing avatar
on the same `CallBackdrop` the call uses.

`ParticipantTile` (LiveKit hooks) feeds `ParticipantTileView` (pure).
`CallStage` feeds `StageCanvas` (pure). Anything that needs LiveKit stays out of
the pure halves so they render in tests and previews with plain data.

## 2. Stage modes

`resolveStageMode` (in `callStage.utils.ts`) picks one from the occupant count
(participants **plus** ringing invitees) and whether someone is sharing:

| Mode          | When           | Layout                                                                                                                                              |
| ------------- | -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `solo`        | you only       | you full-bleed (video or avatar) + "waiting for others" card when nobody was invited                                                                |
| `oneToOne`    | 2 occupants    | other person full-bleed (`hero`); you as a draggable PiP **only while your camera is on**; tap the PiP to swap                                      |
| `grid`        | 3+             | rows `[2,1] [2,2] [2,2,1] [2,2,2]`; past 6 slots the 6th becomes a "+N" overflow tile that opens the people list                                    |
| `screenShare` | someone shares | the share as a card (pinch / double-tap zoom) above a filmstrip of people; if **you** share, a "You're sharing your screen" card replaces the video |

**Xyne Automatic tile.** The AI agent sits in every call, so — like the
dashboard's `filterAgentTiles` — its tile is hidden until someone invokes it
(`aiController` is set). Hidden, it is also left out of the layout mode, the
header / sheet participant counts and the people list (`filterAgentIdentities`),
so you plus the agent is just "alone", and you, a colleague and the agent is a
1:1.

A hero with no video is the WhatsApp voice layout: big avatar, ripple while
speaking, blurred photo behind. The header carries the name and timer, so the
hero doesn't repeat them.

Tiles are keyed by person (`p:<identity>`, `pending:<userId>`), never by slot,
so switching layouts animates the same tile into its new frame and never
remounts a native video view. Only `left / top / width / height / borderRadius`
are animated — no transforms — because native video surfaces (Android
`SurfaceView`) ignore transforms.

## 3. Ringing and "who is here"

LiveKit only knows who is in the room. `useCallPresence` adds the Zero roster
(`userActiveCalls`). **Ringing follows the dashboard exactly** —
`callRoster.utils.ts` is a port of the dashboard's
`components/Call/ringStatus.utils.ts`; don't add client-side heuristics to it.

A ringing tile exists only when **all** of these hold:

- the call is a **1:1 DM** (`channel.scopeType === DM`) — group DMs, channel
  calls and calls with no DM channel show ring status in the people list
  instead;
- the participant row is `INVITED` with `joinedAt` empty (so never accepted /
  declined / missed / left / requesting);
- not external, not you, not the AI agent, and not already in the LiveKit room
  (the DB lags the join by a webhook round-trip).

The label comes from the backend's `ringStatus`, never from us: **Calling…** by
default, **Ringing…** only once a device confirmed (pulsing ring), **On another
call** for `BUSY` (amber). There are no Declined / No answer / Joining tiles —
when the backend moves a row off `INVITED` the tile simply goes away. The people
sheet uses the same words (`Invited` for guests and channel-broadcast calls,
which are never rung).

> `ringStatus` needs an `@xyne/shared` newer than the dashboard's ring-status
> change (#2129). On older pins the field is absent, so every ringing invitee
> reads **Calling…**; `packages/shared` in this monorepo already includes it.

**No solo flash on an outgoing call.** LiveKit joins the room (fast, a direct
connect) well before the backend's participant row propagates through Zero (a DB
write + replication round trip), so for a moment after connecting the Zero
roster can still be empty. Rather than let that render you alone as the hero
(`useCallPresence` used to do exactly this, then flip to the callee once Zero
caught up — the bug this section exists to prevent), `useCallPresence`
synthesizes a one-entry `Calling…` placeholder **before the call is known to
Zero** (`!isKnownToZero`), using whichever of `heroUserId`'s existing sources
resolved first — the DM channel's partner, or the outgoing call's own
`targetUserIds` for a channel-less call. It only fires for a genuine 1:1
(`heroUserId` is null for a channel/group call already, so no gating logic is
duplicated) and only for someone not already in the room. The moment the real
row arrives, `getRingingInvitees` takes over unchanged — same key, same person,
so the tile updates in place instead of disappearing and reappearing.

The header status line: `Starting call…` → `Joining call…` (dashboard wording;
the connecting screen never claims anyone is ringing), then once in the room and
alone the ring label above, `00:12` once someone else is present,
`Reconnecting…`, `Disconnected`, or `Waiting for others to join`. The timer
starts when the first other human is present (WhatsApp semantics), not when the
room connects. The start is remembered per call in `callTalkClock.ts` (outside
React), so minimising and returning doesn't reset it and the ongoing-call banner
shows the same clock; rejoining the call later starts it fresh.

## 4. Chrome behaviour

- **Immersive** layouts (`solo` / `oneToOne` with a live full-bleed video)
  auto-hide header + controls after 5 s of idle; tap the stage to toggle.
  Everything else keeps them visible.
- The chrome is held visible while any sheet is open, a control request is
  pending, or the connection is not `connected`.
- Ending the call is immediate (no confirmation); a host with others present is
  offered _leave_ vs _end for everyone_ — unchanged from before.
- White fill = off (camera), blue = on; red = muted mic **and** end call —
  matching WhatsApp, where a mute is the one "off" state worth calling out in
  red.
- A control button's fill snaps to its new tone in `callMotion.controlToneMs`
  (90ms, eased out) — short and immediate, since it's confirming a tap that just
  happened, not decorative motion.
- **Mic, camera and screen share respond the instant you tap them**
  (`useOptimisticToggle`), not once `roomMachine` confirms the change. All three
  round-trip through LiveKit (mic/camera also through the native bridge) before
  their real prop flips, which reads as a sluggish button if the UI waits for
  it. The override is dropped the moment the real value catches up — normally
  near-instantly — and self-corrects on its own after 1.2s if a toggle is ever
  denied or silently fails, so the button can never get stuck showing something
  that didn't actually happen.

## 5. Platform notes

- **Audio route.** iOS only exposes the system route picker (LiveKit defaults to
  speaker), so the audio button opens it. Android lists real outputs: the button
  flips speaker ↔ earpiece when those are the only choices and otherwise opens
  _More → Audio output_.
- **Flip camera.** `callRuntimeNativeService.flipCamera()` restarts the
  published camera track with the opposite `facingMode` (no unpublish). The
  self-view is mirrored only on the front lens (`useLocalCameraMirror`).
- **PiP over video (Android).** The self-view's `VideoTrack` uses `zOrder={1}`
  so it draws above the full-bleed remote surface.
- **Connection state.** The status line and network banner read the room's real
  LiveKit state (`useRoomConnectionState`), not
  `roomMachine.context.connectionState`, which folds _reconnecting_ into
  _connecting_ in native mode.
- **Stacking.** The chrome layers deliberately have no `zIndex`: child order in
  `CallScreenLayout` is the stacking order, so `@gorhom/bottom-sheet` sheets
  (which have none) sit above the header and control bar.
- **Screen lock.** While video is on screen the display is kept awake
  (`expo-keep-awake`, tag `lotus-call`).

## 6. Tests

| File                                                  | Covers                                                                                                   |
| ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `tests/unit/components/call/callStage.utils.test.ts`  | layout maths, PiP snapping, status text, audio-route helpers                                             |
| `tests/unit/components/call/callRoster.utils.test.ts` | ringing / joining / declined derivation, titles                                                          |
| `tests/unit/components/call/call-stage.test.tsx`      | `CallStage` + `StageCanvas` with stubbed LiveKit: solo, PiP, swap, ringing, grid, overflow, screen share |
| `tests/unit/components/call/call-ui.test.tsx`         | tile, header, control bar, banner, waiting card                                                          |

Nothing here replaces looking at it on a device: the animations (frame morphing,
PiP snapping, chrome fade) and native video behaviour are not covered by jest.
