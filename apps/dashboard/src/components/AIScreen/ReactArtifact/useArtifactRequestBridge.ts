import { useEffect, type MutableRefObject } from 'react';
import {
  ARTIFACT_DATA_PROTOCOL_VERSION,
  isAppArtifactMessage,
  type HostRequestResultMessage,
} from './artifactData.constants';
import { API_BASE_URL } from '../../../config';
import type { PreviewClientRef } from './useArtifactDataBridge';

// The backend origin the dashboard's own api client talks to. On localhost that
// is :3001 (there is no /api vite proxy in dev); in prod it's same-origin. /claw
// stays same-origin (it IS proxied in dev). API_BASE_URL ends in '/api'.
const API_ORIGIN = (() => {
  try {
    return new URL(API_BASE_URL, window.location.origin).origin;
  } catch {
    return window.location.origin;
  }
})();

interface BridgeArgs {
  previewRef: MutableRefObject<PreviewClientRef | null>;
  /** The saved app's id. Injected into storage requests so an app can only ever
   *  touch its OWN storage — the app never sets (or can spoof) it. */
  appId?: string;
}

/** Storage requests carry appId in their JSON body; the host owns that value. */
const STORAGE_PREFIX = '/claw/api/v1/artifact-app-storage/';

/** The only request headers forwarded from the (untrusted) app. Everything else
 *  the app tries to set is dropped; the host sets identity headers itself. */
const FORWARDABLE_HEADERS = ['content-type', 'accept', 'x-route-env'];

/**
 * The ONLY backend paths an app may reach through the proxy. It runs untrusted
 * author code with the viewer's session, so this is an explicit allow-list, not
 * a broad prefix: the public SDK gateway (`/api/sdk/`) and per-app storage
 * (`STORAGE_PREFIX`). Deliberately NOT all of `/claw/` — that would expose every
 * other (and future) claw route to the app as the viewer. Add a specific path
 * here only after deciding it is safe to run as arbitrary app code. Requests are
 * resolved same-origin below, so an absolute URL to another host can never match.
 */
const ALLOWED_PREFIXES = ['/api/sdk/', STORAGE_PREFIX];

/**
 * Runs an app's backend `fetch` calls as the current viewer.
 *
 * A published app is on the bundler origin with no cookies, so it cannot reach
 * the API itself. Its SDK / storage `fetch`es are tunnelled here over
 * postMessage; the dashboard performs the real SAME-ORIGIN fetch — the viewer's
 * httpOnly cookie authenticates it — and posts the response back. Same
 * viewer-session correctness as the data bridge (each person sees only their own
 * rows), and the app never holds a token.
 *
 * URLs are allow-listed to the backend paths above and resolved same-origin, so
 * an app cannot borrow the viewer's session to hit arbitrary endpoints.
 *
 * Lives entirely in the effect — nothing enters React state, or the memoised
 * sandbox would tear down and re-bundle (see useArtifactDataBridge).
 */
export function useArtifactRequestBridge({ previewRef, appId }: BridgeArgs): void {
  useEffect(() => {
    /** The app's window, resolved at call time — the iframe is replaced on reload. */
    const appWindow = (): Window | null =>
      previewRef.current?.getClient()?.iframe?.contentWindow ?? null;

    const post = (message: HostRequestResultMessage): void => {
      const target = appWindow();
      if (!target) return;
      try {
        target.postMessage(message, '*');
      } catch {
        /* the app's own fetch timeout will fire */
      }
    };

    const reply = (
      requestId: string,
      status: number,
      headers: Record<string, string>,
      body: string,
      error?: string,
    ): void =>
      post({
        source: 'xyne-artifact-host',
        v: ARTIFACT_DATA_PROTOCOL_VERSION,
        type: 'request-result',
        requestId,
        status,
        headers,
        body,
        ...(error ? { error } : {}),
      });

    /** Resolve + validate the requested URL: same-origin only, allow-listed path. */
    const resolveUrl = (raw: string): URL | null => {
      try {
        const url = new URL(raw, window.location.origin);
        if (url.origin !== window.location.origin) return null;
        if (!ALLOWED_PREFIXES.some(prefix => url.pathname.startsWith(prefix))) return null;
        return url;
      } catch {
        return null;
      }
    };

    const run = async (
      requestId: string,
      method: string,
      rawUrl: string,
      headers: Record<string, string> | undefined,
      body: string | undefined,
    ): Promise<void> => {
      const url = resolveUrl(rawUrl);
      if (!url) {
        reply(requestId, 403, {}, '', `Blocked: "${rawUrl}" is not an allowed backend URL.`);
        return;
      }
      try {
        // Forward only a known-safe subset of the app's request headers — the
        // host owns identity/scoping and must not let untrusted app code set
        // arbitrary headers on an authenticated call. x-workspace-id is set here,
        // derived from the URL's first segment exactly as the api client does, so
        // /api/sdk queries scope to the active workspace.
        const outHeaders: Record<string, string> = {};
        for (const [name, value] of Object.entries(headers ?? {})) {
          if (FORWARDABLE_HEADERS.includes(name.toLowerCase())) outHeaders[name] = value;
        }
        const firstSegment = window.location.pathname.replace(/^\//, '').split('/')[0];
        if (firstSegment && firstSegment !== 'auth' && firstSegment !== 'newWindow') {
          outHeaders['x-workspace-id'] = firstSegment;
        }

        // Storage requests carry appId in their body — the app leaves it blank
        // and we set it to THIS app's id, so an app can only touch its own store.
        let outBody = body;
        if (appId && typeof body === 'string' && body && url.pathname.startsWith(STORAGE_PREFIX)) {
          try {
            outBody = JSON.stringify({ ...(JSON.parse(body) as Record<string, unknown>), appId });
          } catch {
            /* not JSON — forward unchanged */
          }
        }

        // /api → the backend origin (no /api proxy in dev); /claw → same-origin
        // (proxied). credentials:'include' sends the viewer's cookie either way
        // (the api client already relies on CORS for the cross-origin /api case).
        const target = url.pathname.startsWith('/api/')
          ? `${API_ORIGIN}${url.pathname}${url.search}`
          : url.toString();
        const res = await fetch(target, {
          method,
          headers: outHeaders,
          ...(outBody !== undefined ? { body: outBody } : {}),
          credentials: 'include',
        });
        const text = await res.text();
        reply(requestId, res.status, Object.fromEntries(res.headers.entries()), text);
      } catch (err) {
        reply(requestId, 0, {}, '', err instanceof Error ? err.message : 'Request failed.');
      }
    };

    const onMessage = (event: MessageEvent): void => {
      if (!isAppArtifactMessage(event.data)) return;
      // Several artifacts can be mounted at once and all post to this window, so
      // only accept messages from *our* iframe.
      const target = appWindow();
      if (!target || event.source !== target) return;
      if (event.data.type !== 'request') return;

      const { requestId, method, url, headers, body } = event.data;
      if (!requestId || !method || !url) return;
      void run(requestId, method, url, headers, body);
    };

    window.addEventListener('message', onMessage);
    return (): void => window.removeEventListener('message', onMessage);
  }, [previewRef, appId]);
}
