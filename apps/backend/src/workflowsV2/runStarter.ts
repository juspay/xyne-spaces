import { AsyncLocalStorage } from 'node:async_hooks';

// Only a person's own trigger or rerun names a starter. Event dispatch also runs inside a request, but for whoever caused the event.
const starter = new AsyncLocalStorage<string>();

export const RUN_STARTING_ROUTES = new Set(['POST /workflows/:id/trigger', 'POST /executions/:execId/rerun']);

export const withRunStarter = <T>(userId: string, fn: () => Promise<T>): Promise<T> => starter.run(userId, fn);

export const currentRunStarter = (): string | undefined => starter.getStore();
