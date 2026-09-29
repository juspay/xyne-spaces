/**
 * Xyne data layer.
 *
 * Published, the app runs in a cross-origin sandbox with no cookie, so it can't
 * call the backend directly. Its SDK/storage fetches are tunnelled to the host
 * (the dashboard), which performs the real same-origin fetch as the viewer — so
 * you only ever see your own data and no token lives in the app. Contract (see
 * the dashboard's useArtifactRequestBridge):
 *   app  -> host: { source:'xyne-artifact',      v:1, type:'request',        requestId, method, url, headers?, body? }
 *   host -> app:  { source:'xyne-artifact-host', v:1, type:'request-result', requestId, status, headers, body, error? }
 *
 * Local dev (npm run dev): no host, so fetches hit the network directly with the
 * .env token (values injected by Vite's define block — see vite.config.ts).
 *
 * Usage:
 *   const { spaces, storage } = await xyne();
 *   const channels = await spaces.channels.listAll();
 *   await storage.collection('prefs').put('theme', 'dark');
 */
import { createClient, type SlimSpacesClient } from './vendor/spaces-sdk.js';
import { REQUEST_TIMEOUT_MS } from './config';
import { XyneStorageClient } from './vendor/storage-sdk.js';

// Injected by Vite in local dev; undefined in the sandbox (guarded with typeof).
declare const __XYNE_TOKEN__: string;
declare const __XYNE_APP_ID__: string;

const embedded = window.parent !== window;

if (embedded) {
  // Tunnel backend fetches (/api/*, /claw/*) to the host over postMessage; the
  // host runs them as the viewer. The app never holds a token.
  const realFetch = window.fetch.bind(window);
  const BACKEND = /^\/(api|claw)\//;
  window.fetch = (input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> => {
    const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const u = new URL(raw, location.href);
    const path = u.pathname + u.search; // a same-origin path; the host resolves it
    if (!BACKEND.test(path)) return realFetch(input as RequestInfo, init);

    const requestId = crypto.randomUUID();
    return new Promise<Response>(resolve => {
      const onMessage = (e: MessageEvent): void => {
        const d = e.data;
        if (
          e.source !== window.parent ||
          d?.source !== 'xyne-artifact-host' ||
          d.type !== 'request-result' ||
          d.requestId !== requestId
        ) {
          return;
        }
        window.removeEventListener('message', onMessage);
        resolve(
          new Response(d.error ? (d.error as string) : (d.body as string), {
            status: d.status || (d.error ? 502 : 200),
            headers: (d.headers as Record<string, string>) ?? {},
          }),
        );
      };
      window.addEventListener('message', onMessage);
      const headers = init.headers ? Object.fromEntries(new Headers(init.headers).entries()) : undefined;
      window.parent.postMessage(
        {
          source: 'xyne-artifact',
          v: 1,
          type: 'request',
          requestId,
          method: init.method ?? 'GET',
          url: path,
          ...(headers ? { headers } : {}),
          ...(typeof init.body === 'string' ? { body: init.body } : {}),
        },
        '*',
      );
    });
  };
}

// Published: baseUrl '' -> the SDK builds relative /api & /claw paths, which the
// shim tunnels. Local dev: real host + token from .env. The typeof check must be
// INLINE — referencing an injected global any other way throws a ReferenceError
// in the sandbox, where Vite never defined it; embedded also short-circuits so
// the globals are never touched when published.
// Same-origin base: the SDK builds <origin>/api & <origin>/claw. In dev the Vite
// proxy forwards them; embedded, the host bridge intercepts them. (The SDK needs a
// valid absolute base for `new URL`, so '' won't do.)
const baseUrl = window.location.origin;
const token = embedded ? undefined : typeof __XYNE_TOKEN__ !== 'undefined' ? __XYNE_TOKEN__ : undefined;
const appId = embedded ? '' : typeof __XYNE_APP_ID__ !== 'undefined' ? __XYNE_APP_ID__ : '';

// Some pages (large projects crawled with custom fields attached) take well over the SDK's
// 30 s default, so allow longer.
export const spaces: SlimSpacesClient = createClient({ baseUrl, apiKey: token, timeout: REQUEST_TIMEOUT_MS });
export const storage = new XyneStorageClient({ baseUrl, token: token ?? '', appId });
/** App storage needs an app id: published, the host supplies it; locally it comes from `spaces app push`. */
export const storageAvailable = embedded || appId !== '';

/** The authenticated Xyne clients. */
export async function xyne(): Promise<{ spaces: SlimSpacesClient; storage: XyneStorageClient }> {
  return { spaces, storage };
}
