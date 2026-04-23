/**
 * True when the dashboard is rendering inside an Electron `<webview>` (the
 * in-app browser panel's tab), false in the main Electron window or a plain
 * web browser.
 *
 * We piggy-back on the fact that the webview preload
 * (`electron/src/webview-preload.js`) only exposes `electronAPI.sendToHost`,
 * whereas the main preload (`electron/src/preload.ts`) exposes a wide API but
 * no `sendToHost`. So the presence of `sendToHost` uniquely identifies the
 * webview context — no new plumbing needed.
 *
 * Used by `AppRoot` / `ChatScreen` to skip rendering app chrome
 * (`GlobalTopBar`, `AppSidebar`, `ChatDirectory`, `GlobalCommandMenu`, etc.)
 * inside the panel so the user sees only the conversation/thread view.
 */
export const useIsInPanelWebview = (): boolean =>
  typeof window !== 'undefined' && typeof window.electronAPI?.sendToHost === 'function';
