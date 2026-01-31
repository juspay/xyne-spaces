# React Native <-> Web Bridge

This document gives native engineers everything needed to integrate the dashboard when it is hosted inside a React Native `WebView`. Keep it handy while implementing, because the same schema is used on both sides.

## Where Things Live
- Web bridge implementation: `src/utils/reactNativeBridge.ts`
- Auth usage example (sign-in flow + listeners): `src/providers/AuthProvider.tsx`
- This document: `docs/react-native-bridge.md` (import the repo in your IDE and open this file directly)

## Detecting the WebView
The web app calls `detectReactNativeWebView()` on start-up. Detection works in two ways:
1. Preferred: native injects `window.ReactNativeWebView.postMessage`. As soon as that function exists the web assumes it is inside a RN host.
2. Fallback: user-agent heuristics for Android/iOS WebViews or a UA token containing `ReactNative`. This keeps the UI in "native mode" even before your bridge script runs.

Once detected the app starts the bridge (`reactNativeBridge.initialize()`) which automatically sends a `WEB_APP_READY` message (see contract below). If the heuristic is wrong nothing breaks because `postMessage` is still required for actual data exchange.

## Message Envelope
Every message is JSON with this envelope:
```json
{
  "channel": "xyne-spaces-bridge",
  "source": "xyne-dashboard" | "xyne-native",
  "type": "<see enums below>",
  "version": 1,
  "timestamp": 1738000000000,
  "payload": { ... }
}
```
- Messages without the `channel` or with a different source are ignored.
- Version can be bumped later; web currently accepts any number but defaults to `1`.

### Web → Native (`NativeOutboundMessageType`)
| Type | Payload | Notes |
| --- | --- | --- |
| `WEB_APP_READY` | `{ path: string; version: string }` | Sent immediately after initialization so native knows the current route and the deployed app version (`VITE_APP_VERSION` falls back to `web`). |
| `REQUEST_GOOGLE_SIGN_IN` | `{ reason?: string }` | Tells the host to launch Google auth. UI shows a spinner until a response arrives. |
| `WEB_SIGN_OUT` | `{ reason?: string }` | Emitted when the user signs out in the browser so the host can clear its state. |
| `AUTH_STATE_SYNC` | `{ isAuthenticated: boolean; user?: { id; name; email; picture? } \| null }` | Sent any time the auth context changes so native can mirror the profile. |

### Native → Web (`NativeInboundMessageType`)
| Type | Payload | Notes |
| --- | --- | --- |
| `NATIVE_READY` | `{ platform?: 'ios' \| 'android'; version?: string }` | Optional handshake for logging; also flips `reactNativeBridge.isNativeReady()` to `true`. |
| `GOOGLE_SIGN_IN_RESULT` | `{ success: boolean; sessionId?: string \| null; userId?: string; hasRefreshToken?: boolean; error?: string; errorMessage?: string }` | Required response to `REQUEST_GOOGLE_SIGN_IN`. `sessionId` **must** be populated once the native layer has exchanged Google credentials and injected the Secure/HttpOnly cookies; the dashboard refuses to continue without it. Tokens are exchanged and stored via cookies on native; the WebView should not receive raw tokens. On failure the `errorMessage` is shown to the user. |
| `NATIVE_SIGN_OUT` | `{ reason?: string }` | Lets native force a logout (e.g., refresh token revoked). The web layer will clear all local state. |

## Implementing on the Native Side
1. Inject a small JS shim before the page loads that attaches your `postMessage` handler to `window.ReactNativeWebView`.
2. Listen for incoming messages via `onMessage` in the React Native `WebView`. Parse the JSON, check `channel === 'xyne-spaces-bridge'`, then branch on `type`.
3. Respond to `REQUEST_GOOGLE_SIGN_IN` by kicking off your native Google auth flow, exchanging credentials with the backend, injecting the cookie, then `postMessage` a `GOOGLE_SIGN_IN_RESULT` envelope (include `sessionId`).
4. Optionally send `NATIVE_READY` once the host is ready to receive events; the dashboard uses it only for diagnostics.

## Testing Tips
- You can emulate native responses from the browser console by running:
  ```ts
  (window as any).ReactNativeWebView.postMessage(
    JSON.stringify({
      channel: 'xyne-spaces-bridge',
      source: 'xyne-native',
      type: 'GOOGLE_SIGN_IN_RESULT',
      version: 1,
      timestamp: Date.now(),
      payload: { success: true, sessionId: 'mock-session', userId: '123' }
    })
  );
  ```
  This helps verify the UI wiring before integrating native code.
- To confirm detection logic, log `detectReactNativeWebView()` directly or watch the `[AUTH] Running inside a React Native WebView` message in the browser console.
- When a native `GOOGLE_SIGN_IN_RESULT` arrives without `success/sessionId/userId`, the dashboard prints `[AUTH] Native Google auth failed payload:` with the payload for quick debugging.

Reach out to the web team if the bridge contract needs to grow; enums and payloads are centralized in `src/utils/reactNativeBridge.ts` and are safe to import for shared TypeScript types.
