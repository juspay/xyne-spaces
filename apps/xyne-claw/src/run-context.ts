import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Per-run context that classifier call sites read without threading it through
 * every signature: the run's task, and a lazy view of the live transcript.
 * The transcript getter reads the session each time, so a tool executing
 * mid-loop sees every turn up to (and including) the call that invoked it.
 */
interface RunContext {
  task: string;
  messages?: () => readonly unknown[];
}

const store = new AsyncLocalStorage<RunContext>();

export function pinRunTask(task: string): void {
  store.enterWith({ task });
}

export function currentRunTask(): string {
  return store.getStore()?.task ?? "";
}

/**
 * Per-run flags claw-auth forwards for create-page chat turns: `instant` (skip
 * the pre-run deliberation) and `disableTools` (an empty tool palette). Pinned
 * once at run entry so pre-run helpers such as the mode router can honour them.
 */
export interface RunFlags {
  instant: boolean;
  disableTools: boolean;
}

const flagStore = new AsyncLocalStorage<RunFlags>();

export function pinRunFlags(flags: { instant?: unknown; disableTools?: unknown }): RunFlags {
  const pinned: RunFlags = { instant: flags.instant === true, disableTools: flags.disableTools === true };
  flagStore.enterWith(pinned);
  return pinned;
}

export function getRunFlags(): RunFlags {
  return flagStore.getStore() ?? { instant: false, disableTools: false };
}

/** Attach the live transcript to the run pinned by pinRunTask. No-op outside a run. */
export function attachRunMessages(getter: () => readonly unknown[] | undefined): void {
  const ctx = store.getStore();
  if (!ctx) return;
  ctx.messages = () => {
    try {
      return getter() ?? [];
    } catch {
      return [];
    }
  };
}

export function currentRunMessages(): readonly unknown[] {
  return store.getStore()?.messages?.() ?? [];
}
