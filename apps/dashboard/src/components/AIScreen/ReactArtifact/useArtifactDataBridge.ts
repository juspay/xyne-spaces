import { useEffect, type MutableRefObject } from 'react';
import type { SandpackPreviewRef } from '@codesandbox/sandpack-react';
import { executeFallbackQuery } from '../../../services/zeroFallbackClient';
import { executeArtifactAstQuery } from '../../../services/artifactAstClient';
import { executeFallbackMutate } from '../../../services/zeroMutateFallbackClient';
import {
  ARTIFACT_DATA_PROTOCOL_VERSION,
  MAX_INFLIGHT_MUTATIONS,
  MAX_ROWS_PER_REQUIREMENT,
  REFRESH_THROTTLE_MS,
  isAppArtifactMessage,
  validateDataSource,
  type ArtifactDataEntry,
  type ArtifactDataRequirement,
  type ArtifactDataSnapshot,
  type HostDataMessage,
  type HostMutateResultMessage,
} from './artifactData.constants';

/** The SandpackPreview ref itself — only its client's iframe is used here. */
export type PreviewClientRef = SandpackPreviewRef;

interface BridgeArgs {
  requirements: ArtifactDataRequirement[] | undefined;
  /** Whether this app may write. Purely the feature flag — authorization itself
   *  is the server's job, per the caller's own ACLs. */
  canWrite: boolean;
  /** Identifies the app in write logs, so a change can be traced to its source. */
  appId?: string;
  previewRef: MutableRefObject<PreviewClientRef | null>;
  /** Assigned by the bridge so the header refresh button can trigger a re-resolve.
   *  A ref (not a prop) so triggering refresh never re-renders the sandbox. */
  refreshRef: MutableRefObject<(() => Promise<void>) | null>;
}

/**
 * Resolves an app's declared data requirements as the current viewer and posts
 * the results into its preview iframe.
 *
 * The app cannot fetch for itself — it runs on the bundler's origin with no
 * cookies — so the dashboard is the only thing that can talk to the API. That
 * indirection is also what makes published apps correct: the fetch happens with
 * the *viewer's* session, so each person sees only rows their own permissions
 * allow, instead of a snapshot baked from the author's.
 *
 * Everything here lives in refs. Data must never enter React state: this hook
 * runs inside the memoized sandbox, and a re-render there tears down the iframe
 * and forces a full re-bundle.
 */
export function useArtifactDataBridge({
  requirements,
  canWrite,
  appId,
  previewRef,
  refreshRef,
}: BridgeArgs): void {
  useEffect(() => {
    const declared = requirements ?? [];
    // A purely static artifact needs neither reads nor a listener. An app that
    // only writes still does, so key off both.
    if (declared.length === 0 && !canWrite) return;

    let cancelled = false;
    const snapshot: ArtifactDataSnapshot = {};
    let lastResolveStartedAt = 0;
    const inflight = new Set<string>();

    for (const requirement of declared) {
      snapshot[requirement.name] = requirement.source
        ? { status: 'loading' }
        : {
            // Pre-live-data requirement. Say so, rather than leaving the app
            // spinning on a source that will never arrive.
            status: 'error',
            error: 'This data source predates live data and cannot be loaded.',
          };
    }

    /** The app's window, resolved at call time — the client may not exist yet
     *  under lazy init, and the iframe is replaced on reload. */
    const appWindow = (): Window | null =>
      previewRef.current?.getClient()?.iframe?.contentWindow ?? null;

    const postSnapshot = (): void => {
      const target = appWindow();
      if (!target) return;
      const message: HostDataMessage = {
        source: 'xyne-artifact-host',
        v: ARTIFACT_DATA_PROTOCOL_VERSION,
        type: 'data',
        payloads: snapshot,
      };
      try {
        target.postMessage(message, '*');
      } catch {
        // Structured clone failed — something in a result isn't serialisable.
        // Replace the offending payloads with an error so the app can render.
        for (const key of Object.keys(snapshot)) {
          if (snapshot[key]?.status === 'ready') {
            snapshot[key] = { status: 'error', error: 'This data could not be displayed.' };
          }
        }
        try {
          target.postMessage({ ...message, payloads: snapshot }, '*');
        } catch {
          /* give up — the app keeps showing its loading state */
        }
      }
    };

    const toEntry = (value: unknown): ArtifactDataEntry => {
      if (Array.isArray(value) && value.length > MAX_ROWS_PER_REQUIREMENT) {
        return {
          status: 'ready',
          data: value.slice(0, MAX_ROWS_PER_REQUIREMENT),
          meta: { truncated: true, totalRows: value.length },
        };
      }
      return { status: 'ready', data: value };
    };

    const describeError = (err: unknown): string => {
      const status = (err as { status?: number })?.status;
      if (status === 401 || status === 403) {
        return 'Your session expired — reload the page and open this app again.';
      }
      return err instanceof Error && err.message
        ? err.message
        : 'Live data is temporarily unavailable.';
    };

    const resolveOne = async (requirement: ArtifactDataRequirement): Promise<void> => {
      const { source } = requirement;
      if (!source) return;

      // Re-check before touching the network: this payload may have been saved
      // when a source was still allowed, or hand-edited since.
      const invalid = validateDataSource(source);
      if (invalid) {
        snapshot[requirement.name] = { status: 'error', error: invalid };
        return;
      }

      try {
        const value =
          source.kind === 'query'
            ? await executeFallbackQuery(source.query, source.args ?? {})
            : await executeArtifactAstQuery(source);
        if (cancelled) return;
        snapshot[requirement.name] = toEntry(value);
      } catch (err) {
        if (cancelled) return;
        snapshot[requirement.name] = { status: 'error', error: describeError(err) };
      }
    };

    /** Resolve one requirement, or all of them. Each posts as soon as it
     *  settles, so the app fills in progressively instead of waiting for the
     *  slowest query. Requirements are fetched one call each — the batch
     *  endpoint is atomic, so one bad source would sink its siblings. */
    const resolve = async (name?: string): Promise<void> => {
      const targets = declared.filter(r => r.source && (name === undefined || r.name === name));
      if (targets.length === 0) return;

      lastResolveStartedAt = Date.now();
      for (const requirement of targets) {
        snapshot[requirement.name] = { status: 'loading' };
      }
      postSnapshot();

      await Promise.allSettled(
        targets.map(requirement =>
          resolveOne(requirement).then((): void => {
            if (!cancelled) postSnapshot();
          }),
        ),
      );
    };

    const postMutateResult = (requestId: string, ok: boolean, error?: string): void => {
      const target = appWindow();
      if (!target) return;
      const message: HostMutateResultMessage = {
        source: 'xyne-artifact-host',
        v: ARTIFACT_DATA_PROTOCOL_VERSION,
        type: 'mutate-result',
        requestId,
        ok,
        ...(error ? { error } : {}),
      };
      try {
        target.postMessage(message, '*');
      } catch {
        /* the app's own timeout will fire */
      }
    };

    /** Run one mutation as the current viewer. The server authorizes it under
     *  their own per-table ACL, so a viewer with narrower access is refused
     *  there and the message is handed back to the app. */
    const runMutation = async (requestId: string, name: string, args: unknown): Promise<void> => {
      if (!canWrite) {
        postMutateResult(requestId, false, 'This app is not allowed to make changes.');
        return;
      }
      if (inflight.has(requestId)) return;
      if (inflight.size >= MAX_INFLIGHT_MUTATIONS) {
        postMutateResult(requestId, false, 'Too many changes at once — try again in a moment.');
        return;
      }

      inflight.add(requestId);
      try {
        // eslint-disable-next-line no-console -- attribution: trace a write back to its app
        console.info('[artifact-app] mutate', { appId: appId ?? '(unsaved)', name });
        await executeFallbackMutate(name, args);
        if (cancelled) return;
        postMutateResult(requestId, true);
        // Reflect the change without the app having to refetch.
        void resolve();
      } catch (err) {
        if (cancelled) return;
        postMutateResult(requestId, false, describeError(err));
      } finally {
        inflight.delete(requestId);
      }
    };

    const onMessage = (event: MessageEvent): void => {
      if (!isAppArtifactMessage(event.data)) return;
      // Several artifacts can be mounted at once and they all post to this same
      // window, so only accept messages from *our* iframe.
      const target = appWindow();
      if (!target || event.source !== target) return;

      if (event.data.type === 'ready') {
        // Re-deliver what we already hold. An iframe reload must not re-query.
        postSnapshot();
        return;
      }

      if (event.data.type === 'refresh') {
        if (Date.now() - lastResolveStartedAt < REFRESH_THROTTLE_MS) return;
        void resolve(event.data.name);
        return;
      }

      if (event.data.type === 'mutate') {
        const { requestId, name, args } = event.data;
        if (!requestId || !name) return;
        void runMutation(requestId, name, args);
      }
    };

    window.addEventListener('message', onMessage);
    refreshRef.current = (): Promise<void> => resolve();
    void resolve();

    return (): void => {
      cancelled = true;
      window.removeEventListener('message', onMessage);
      refreshRef.current = null;
    };
  }, [requirements, canWrite, appId, previewRef, refreshRef]);
}
