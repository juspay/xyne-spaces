import { useEffect, type MutableRefObject } from 'react';
import {
  cancelArtifactAppAgentRun,
  getArtifactAppAgentRun,
  listArtifactAppAgentRuns,
  listArtifactAppAgents,
  startArtifactAppAgentRun,
  type ArtifactAppAgent,
  type ArtifactAppAgentRun,
  type ArtifactAppRef,
} from '../../../services/claw/artifactAppAgentsService';
import { consumeConversationLiveStream } from '../../../services/XyneAI/liveConversationStream';
import {
  ARTIFACT_DATA_PROTOCOL_VERSION,
  MAX_AGENT_INVOCATIONS,
  MAX_AGENT_INVOCATION_RESULT_CHARS,
  isAppArtifactMessage,
  type HostAgentEventMessage,
  type HostAgentStateMessage,
} from './artifactData.constants';
import type { PreviewClientRef } from './useArtifactDataBridge';

interface AgentBridgeArgs {
  /** Which app this is. Both fields may be absent for a preview that has not
   *  been persisted yet — agent runs are then simply unavailable. */
  appId?: string;
  attachmentId?: string;
  /** Feature flag only. Authorization is the server's, per the caller's ACLs. */
  canInvokeAgents: boolean;
  previewRef: MutableRefObject<PreviewClientRef | null>;
}

/** Live-stream event names carrying assistant text, per conversation-bus LiveEvent. */
type LiveKind = 'snapshot' | 'delta' | 'reasoning' | 'invocation' | 'label' | 'done';

/**
 * Bridges `useXyneAgent()` in a generated app to real claw agent runs.
 *
 * Deliberately separate from `useArtifactDataBridge` rather than folded into it.
 * The two have different lifecycles — reads resolve in milliseconds and are
 * re-resolved on demand, while an agent run takes minutes and outlives the app
 * entirely — and the data bridge skips its listener altogether for an artifact
 * with no requirements, which an agent-only app would need. Both hooks pair to
 * the same iframe by `event.source` and ignore each other's message types.
 *
 * The durability rule this exists to honour: dispatch returns as soon as the run
 * is accepted, and the run continues server-side whether or not this hook is
 * still mounted. Nothing here may cancel a run on unmount — only an explicit
 * `agent-cancel` does. What unmounting stops is *watching*, not running.
 *
 * Everything lives in closure state for the same reason as the data bridge: this
 * runs inside the memoized sandbox, and React state here would remount the
 * iframe and force a re-bundle.
 */
export function useArtifactAgentBridge({
  appId,
  attachmentId,
  canInvokeAgents,
  previewRef,
}: AgentBridgeArgs): void {
  useEffect(() => {
    if (!canInvokeAgents) {
      // Still listen, so an app that calls the hook is told it is unavailable
      // and can render a plain message instead of spinning forever.
      return attachUnavailableListener(previewRef);
    }
    if (!appId && !attachmentId) {
      return attachUnavailableListener(previewRef);
    }

    const ref: ArtifactAppRef = {
      ...(appId ? { appId } : {}),
      ...(attachmentId ? { attachmentId } : {}),
    };
    let cancelled = false;

    /** Per run key. A key is one conversation thread. */
    interface KeyState {
      runId: string | null;
      conversationId: string | null;
      agentSlug: string | null;
      status: HostAgentStateMessage['run']['status'];
      output: string;
      reasoning: string;
      invocations: unknown[];
      label: string | null;
      error: string | null;
      /** Aborts the watcher, never the run. */
      watcher: AbortController | null;
      /** True once the watcher should stop; read by the stream helper. */
      watchClosed: boolean;
    }

    const keys = new Map<string, KeyState>();
    let agents: ArtifactAppAgent[] = [];
    let agentsLoaded = false;

    function stateFor(key: string): KeyState {
      let state = keys.get(key);
      if (!state) {
        state = {
          runId: null,
          conversationId: null,
          agentSlug: null,
          status: 'idle',
          output: '',
          reasoning: '',
          invocations: [],
          label: null,
          error: null,
          watcher: null,
          watchClosed: true,
        };
        keys.set(key, state);
      }
      return state;
    }

    const appWindow = (): Window | null =>
      previewRef.current?.getClient()?.iframe?.contentWindow ?? null;

    function postToApp(message: HostAgentStateMessage | HostAgentEventMessage): void {
      const target = appWindow();
      if (!target) return;
      try {
        target.postMessage(message, '*');
      } catch {
        /* structured-clone failure — the app's own state simply does not advance */
      }
    }

    function postState(key: string): void {
      const state = stateFor(key);
      postToApp({
        source: 'xyne-artifact-host',
        v: ARTIFACT_DATA_PROTOCOL_VERSION,
        type: 'agent-state',
        runKey: key,
        available: true,
        agents,
        run: {
          runId: state.runId,
          status: state.status,
          output: state.output,
          reasoning: state.reasoning,
          invocations: state.invocations,
          label: state.label,
          error: state.error,
        },
      });
    }

    function postEvent(
      key: string,
      event: Omit<HostAgentEventMessage, 'source' | 'v' | 'type' | 'runKey'>,
    ): void {
      postToApp({
        source: 'xyne-artifact-host',
        v: ARTIFACT_DATA_PROTOCOL_VERSION,
        type: 'agent-event',
        runKey: key,
        ...event,
      });
    }

    /** Adopt a run row into key state. Used on attach and after a run finishes. */
    function adopt(state: KeyState, run: ArtifactAppAgentRun): void {
      state.runId = run.id;
      state.conversationId = run.conversationId;
      state.agentSlug = run.agentSlug;
      state.status = run.status === 'pending' ? 'starting' : run.status;
      state.output = run.output ?? '';
      state.error = run.error;
      state.label = run.currentToolLabel;
      state.invocations = capInvocations(
        Array.isArray(run.toolInvocations) ? (run.toolInvocations as unknown[]) : [],
      );
    }

    /**
     * Watch a run over the live conversation stream.
     *
     * Attaching mid-run is the normal case, not the exception: the server sends a
     * Postgres snapshot first (including the answer written so far), then live
     * deltas. That is what makes a reopened app catch up.
     */
    function watch(key: string): void {
      const state = stateFor(key);
      if (!state.conversationId || !state.agentSlug) return;
      state.watcher?.abort();

      const controller = new AbortController();
      state.watcher = controller;
      state.watchClosed = false;

      void consumeConversationLiveStream({
        conversationId: state.conversationId,
        agentSlug: state.agentSlug,
        signal: controller.signal,
        isClosed: () => state.watchClosed || cancelled,
        onEvent: (name, data) => {
          if (cancelled) return;
          handleLiveEvent(key, name as LiveKind, data);
        },
      }).then(() => {
        // The stream ended without a terminal event (transport died, retries
        // exhausted). Never leave the app spinning — reconcile against the row,
        // which the callback has by now written whatever actually happened to.
        if (!cancelled && !state.watchClosed) void finalize(key);
      });
    }

    function handleLiveEvent(key: string, name: LiveKind, data: Record<string, unknown>): void {
      const state = stateFor(key);

      if (name === 'snapshot') {
        const partial = data['partial'] as { content?: string; reasoning?: string } | undefined;
        if (partial) {
          state.output = partial.content ?? '';
          state.reasoning = partial.reasoning ?? '';
        }
        const inProgress = Array.isArray(data['inProgress'])
          ? (data['inProgress'] as unknown[])
          : [];
        if (inProgress.length) state.invocations = capInvocations(inProgress);
        state.status = 'running';
        postState(key);
        return;
      }

      if (name === 'delta') {
        const text = typeof data['textDelta'] === 'string' ? data['textDelta'] : '';
        const reasoning = typeof data['reasoningDelta'] === 'string' ? data['reasoningDelta'] : '';
        if (text) {
          state.output += text;
          postEvent(key, { kind: 'delta', text });
        }
        if (reasoning) {
          state.reasoning += reasoning;
          postEvent(key, { kind: 'reasoning', text: reasoning });
        }
        return;
      }

      if (name === 'label') {
        const label = typeof data['toolLabel'] === 'string' ? data['toolLabel'] : null;
        state.label = label;
        postEvent(key, { kind: 'label', ...(label ? { label } : {}) });
        return;
      }

      if (name === 'invocation') {
        if (state.invocations.length >= MAX_AGENT_INVOCATIONS) return;
        const one = capInvocations([data['toolInvocation']]);
        if (one.length === 0) return;
        state.invocations = [...state.invocations, one[0]];
        postEvent(key, { kind: 'invocation', invocation: one[0] });
        return;
      }

      if (name === 'done') {
        state.watchClosed = true;
        void finalize(key);
      }
    }

    /**
     * Read the durable row and send the app the canonical outcome.
     *
     * The live `done` event carries only a status, and accumulated deltas can be
     * missing a window if the stream reconnected — so the answer always comes
     * from the run row, never from what we happened to receive.
     */
    async function finalize(key: string): Promise<void> {
      const state = stateFor(key);
      state.watchClosed = true;
      if (!state.runId) return;
      try {
        const { run } = await getArtifactAppAgentRun(state.runId);
        if (cancelled) return;
        adopt(state, run);
        postEvent(key, {
          kind: 'done',
          status: run.status,
          text: run.output ?? state.output,
          ...(run.error ? { error: run.error } : {}),
        });
        // Followed by full state, so invocations and labels settle too.
        postState(key);
      } catch {
        if (cancelled) return;
        postEvent(key, {
          kind: 'error',
          error: 'Lost track of this run. Reopen the app to check on it.',
        });
      }
    }

    /** Resolve everything the app needs for a key and hand it over. */
    async function attach(key: string): Promise<void> {
      try {
        if (!agentsLoaded) {
          const listed = await listArtifactAppAgents(ref);
          if (cancelled) return;
          agents = listed.agents;
          agentsLoaded = true;
        }

        const { runs } = await listArtifactAppAgentRuns(ref, key);
        if (cancelled) return;

        const state = stateFor(key);
        const latest = runs[0];
        if (latest) {
          adopt(state, latest);
          postState(key);
          // Only follow a run that is still going. A finished one is complete
          // in the row we just read.
          if (latest.status === 'pending' || latest.status === 'running') watch(key);
          return;
        }
        postState(key);
      } catch {
        if (cancelled) return;
        postEvent(key, { kind: 'error', error: 'Could not load agent runs for this app.' });
      }
    }

    async function startRun(key: string, prompt: string, agentSlug?: string): Promise<void> {
      const state = stateFor(key);
      state.status = 'starting';
      state.output = '';
      state.reasoning = '';
      state.invocations = [];
      state.label = null;
      state.error = null;

      try {
        const { run } = await startArtifactAppAgentRun({
          ...ref,
          prompt,
          key,
          ...(agentSlug ? { agentSlug } : {}),
        });
        if (cancelled) return;

        state.runId = run.id;
        state.conversationId = run.conversationId;
        state.agentSlug = run.agentSlug;
        state.status = 'running';
        postEvent(key, { kind: 'accepted', runId: run.id });
        watch(key);
      } catch (err) {
        if (cancelled) return;
        state.status = 'failed';
        state.error = describeError(err);
        postEvent(key, { kind: 'error', error: state.error });
      }
    }

    async function cancelRun(key: string): Promise<void> {
      const state = stateFor(key);
      if (!state.runId) return;
      try {
        await cancelArtifactAppAgentRun(state.runId);
      } catch {
        /* fall through — finalize reads the row and reports what really happened */
      }
      if (cancelled) return;
      state.watchClosed = true;
      state.watcher?.abort();
      void finalize(key);
    }

    const onMessage = (event: MessageEvent): void => {
      if (!isAppArtifactMessage(event.data)) return;
      const target = appWindow();
      if (!target || event.source !== target) return;

      const { type, runKey } = event.data;
      if (type === 'agent-attach' && runKey) {
        void attach(runKey);
        return;
      }
      if (type === 'agent-run' && runKey && event.data.prompt) {
        void startRun(runKey, event.data.prompt, event.data.agentSlug);
        return;
      }
      if (type === 'agent-cancel' && runKey) {
        void cancelRun(runKey);
      }
    };

    window.addEventListener('message', onMessage);

    return (): void => {
      cancelled = true;
      window.removeEventListener('message', onMessage);
      // Stop WATCHING every key. The runs themselves keep going server-side —
      // that is the entire point, and aborting them here would break it.
      keys.forEach(state => {
        state.watchClosed = true;
        state.watcher?.abort();
      });
    };
  }, [appId, attachmentId, canInvokeAgents, previewRef]);
}

/**
 * Tell an app that agent runs are off, so it renders a message rather than
 * waiting on state that will never arrive.
 */
function attachUnavailableListener(
  previewRef: MutableRefObject<PreviewClientRef | null>,
): () => void {
  const onMessage = (event: MessageEvent): void => {
    if (!isAppArtifactMessage(event.data)) return;
    const target = previewRef.current?.getClient()?.iframe?.contentWindow ?? null;
    if (!target || event.source !== target) return;
    const { type, runKey } = event.data;
    if (type !== 'agent-attach' && type !== 'agent-run') return;

    const message: HostAgentStateMessage = {
      source: 'xyne-artifact-host',
      v: ARTIFACT_DATA_PROTOCOL_VERSION,
      type: 'agent-state',
      runKey: runKey ?? 'default',
      available: false,
      agents: [],
      run: {
        runId: null,
        status: 'idle',
        output: '',
        reasoning: '',
        invocations: [],
        label: null,
        error: null,
      },
    };
    try {
      target.postMessage(message, '*');
    } catch {
      /* nothing useful to do */
    }
  };

  window.addEventListener('message', onMessage);
  return (): void => window.removeEventListener('message', onMessage);
}

/**
 * Bound what crosses postMessage. Tool results can be entire result sets, and
 * everything here is structured-cloned into the iframe, so an agent with a long
 * tool loop would otherwise stall the app it is reporting to.
 */
function capInvocations(invocations: unknown[]): unknown[] {
  return invocations
    .filter(isRenderableInvocation)
    .slice(0, MAX_AGENT_INVOCATIONS)
    .map(invocation => {
      const record = invocation as Record<string, unknown>;
      const result = record['result'];
      if (typeof result !== 'string' || result.length <= MAX_AGENT_INVOCATION_RESULT_CHARS) {
        return invocation;
      }
      return {
        ...record,
        result: `${result.slice(0, MAX_AGENT_INVOCATION_RESULT_CHARS)}…`,
        truncated: true,
      };
    });
}

/**
 * Drop the runtime's own plumbing calls. Mirrors the same filter the /live route
 * applies before showing invocations in chat — these are not work the user asked
 * for and reading them as such is misleading.
 */
function isRenderableInvocation(invocation: unknown): boolean {
  if (!invocation || typeof invocation !== 'object') return false;
  const { toolName, args } = invocation as { toolName?: string; args?: unknown };
  if (toolName === 'internal-follow-up-diagnostics') return false;
  if (toolName !== 'ask-user-question') return true;
  return (
    !args ||
    typeof args !== 'object' ||
    (args as { purpose?: string }).purpose !== 'follow_up_suggestions'
  );
}

function describeError(err: unknown): string {
  const status = (err as { status?: number } | null)?.status;
  if (status === 401 || status === 403) {
    return err instanceof Error ? err.message : 'You do not have access to run this agent.';
  }
  if (status === 409) return 'This app is already running an agent. Wait for it to finish.';
  if (status === 429) return 'Too many agent runs recently. Try again in a little while.';
  return err instanceof Error ? err.message : 'Could not start the agent.';
}
