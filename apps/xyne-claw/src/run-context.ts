import { AsyncLocalStorage } from "node:async_hooks";

const store = new AsyncLocalStorage<{ task: string }>();

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
