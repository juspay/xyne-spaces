import { useSyncExternalStore } from 'react';
import type { QueuedStep } from './engine/chain';
import type { EngineState } from './engine/dialogue';
import type { Unsure } from './engine/unsureCard';
import { createStore } from '../../utils/createStore';
import type { AssistantTurn } from './turns';

// A run of an action's plan. `submitted` is the point of no return: once the page's submit has
// been sent, the run can no longer be stopped.
export interface Run {
  controller: AbortController;
  submitted: boolean;
}

/**
 * The assistant's conversation. It lives here, not in a component, so it outlives the surface
 * that started it: the /ai page hands a dialogue over to the side panel, and a run keeps posting
 * after its page is gone. The store holds the data and the few things only it can do: stop a run
 * and start over for another owner. What the assistant does is in useAssistantActions and
 * sessionTurns.
 */
export interface AssistantSession {
  owner: string; // the user and workspace it belongs to
  turns: AssistantTurn[];
  dialogue: EngineState | null; // the request under way, if any
  aside: EngineState | null; // a request put on hold after replies that were not about it
  queued: QueuedStep[]; // the steps of the sentence still to come once the request is done
  unsure: Unsure | null; // the "did you mean" card on screen, if any
  routing: AbortController | null; // the routing call in flight
  run: Run | null; // the plan being carried out
  // Buddy's last reply was something it did: the next sentence is likely still for it.
  acted: boolean;
}

const empty = (owner: string): AssistantSession => ({
  owner,
  turns: [],
  dialogue: null,
  aside: null,
  queued: [],
  unsure: null,
  routing: null,
  run: null,
  acted: false,
});

let session = empty('');
const { subscribe, notify } = createStore();

const update = (patch: Partial<AssistantSession>): void => {
  session = { ...session, ...patch };
  notify();
};

// Stops the run if it has not sent its submit; false when it had, or there was none.
const stopRun = (): boolean => {
  const { run } = session;
  if (!run || run.submitted) return false;
  run.controller.abort();
  return true;
};

export const assistantSession = {
  get: (): AssistantSession => session,
  update,
  stopRun,
  // Another user or workspace never sees this conversation: it starts over, empty.
  ownedBy(owner: string): void {
    if (session.owner === owner) return;
    session.routing?.abort();
    stopRun();
    update(empty(owner));
  },
};

// One part of the session, so a surface re-renders only when what it shows changes. `select` must
// return a primitive or a part held as is, never a new object.
export const useAssistantSession = <T>(select: (current: AssistantSession) => T): T =>
  useSyncExternalStore(subscribe, () => select(session));
