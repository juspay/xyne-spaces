# Chat v3

View and lifecycle rewrite. The data/send engine (`@xyne/shared/messages`) is
consumed, not rewritten.

**Contract:**
[`docs/design/chat-v3-design.md`](../../../docs/design/chat-v3-design.md)
**Build order:**
[`docs/design/chat-v3-implementation-plan.md`](../../../docs/design/chat-v3-implementation-plan.md)

## Layers (arrows point down only)

```
L0  Route edge     app/(protected)/chat/**   flag switch only
L1  intent/        untrusted params → OpenIntent          pure
L2  machine/       OpenIntent + data facts → OpenState    pure
L3  data/ + warm/  subscribe-only adapters + MMKV read    hooks
L4  model/         Conversation[] → ChatRow[]             pure
L5  list/ + rows/  one LegendList engine, one row/kind    view
L6  composer/ + overlays/
L7  scheduling/ + observability/  scoped deferral, openTrace
L8  screens/       ChannelScreen, ThreadScreen (thin)
```

`intent/`, `machine/`, and `model/` import no React and no react-native.
Enforced by ESLint.

## Open session (C4)

`screens/useChatOpen.ts` owns status. It has three effects, each talking to
something React does not own:

1. **Facts → machine** — `dataFactsChanged` / reanchor (reducer is the store)
2. **Clock** — `tick` only while placing (scroll confirm). Query wait is not
   timed out.
3. **Teardown** — scoped deferral token + `teardown` action

Warm MMKV is a lazy `useState` initializer (sync read, not an effect). Open-path
tracing is recorded in `useChatOpen` (`observability/openTrace.ts`).
Pagination-until-land lives in `list/useExpandTowardTarget.ts`. `data/` must not
use `useState` or `useEffect`.

## Flag

`isChatV3Enabled()` in `flag.ts`. Default on for the test release. Turned off
from Settings → **Chat v3** (v2). Leave the chat screen and open it again — the
flag is read once per mount.

With the flag on (the default), channel and thread routes mount the v3 list.
Ticket details' Thread tab does the same.

### Manual try-out

1. Run the app as usual (`yarn start:dev` / iOS / Android).
2. Open a channel or thread — v3 is on unless you already turned it off.
3. Settings → **Chat v3** → off to use the previous chat. Leave Settings and
   reopen the conversation.

### Logic tests (v3 only)

```bash
yarn test:chat-v3
```

Do not use `yarn test` / `yarn test:logic` for this — those still run the whole
existing unit suite.
