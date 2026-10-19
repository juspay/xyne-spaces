/**
 * Shared auth lifecycle state used to reject work that belongs to an older
 * local session. The generation is process-local; protected stores remain the
 * source of truth across process restarts.
 */
let currentGeneration = 0;
let currentOperation = 0;
let authStoreMutationTail = Promise.resolve();
let authNativeMutationTail = Promise.resolve();
let authCookieMutationTail = Promise.resolve();

const AUTH_MUTATION_TIMEOUT_MS = 5000;

type TrackedOperation = {
  generation: number;
  promise: Promise<unknown>;
};

const trackedOperations = new Set<TrackedOperation>();

export function getAuthSessionGeneration(): number {
  return currentGeneration;
}

export function beginAuthSession(): number {
  currentGeneration += 1;
  currentOperation += 1;
  return currentGeneration;
}

/** Advance the committed session without cancelling the auth operation that
 * just produced it. A later logout or competing operation can still supersede
 * it explicitly. */
export function commitAuthSession(): number {
  currentGeneration += 1;
  return currentGeneration;
}

export function beginAuthOperation(): number {
  currentOperation += 1;
  return currentOperation;
}

export function getAuthOperation(): number {
  return currentOperation;
}

export function isAuthOperationCurrent(operation: number): boolean {
  return operation === currentOperation;
}

export function isAuthSessionCurrent(generation: number): boolean {
  return generation === currentGeneration;
}

export function isAuthScopeCurrent(generation: number, operation: number): boolean {
  return isAuthSessionCurrent(generation) && isAuthOperationCurrent(operation);
}

/** Serialize protected-store writes/deletes so an old cleanup cannot overtake
 * a newer session's credential write. A stale queued mutation is skipped. */
function withMutationTimeout(operation: Promise<void>, timeoutMs: number): Promise<void> {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return operation;
  }
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timeoutHandle = setTimeout(() => {
      reject(new Error(`Auth mutation timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });
  return Promise.race([operation, timeout]).finally(() => {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }
  });
}

function enqueueSerializedMutation(
  mutation: () => void | Promise<void>,
  shouldRun: () => boolean,
  queue: 'store' | 'native' | 'cookie',
  timeoutMs: number,
): Promise<void> {
  const previous =
    queue === 'cookie'
      ? authCookieMutationTail
      : queue === 'native'
        ? authNativeMutationTail
        : authStoreMutationTail;
  const run = previous.then(async () => {
    if (!shouldRun()) {
      return;
    }
    await mutation();
  });
  const settled = run.then(
    () => undefined,
    () => undefined,
  );
  if (queue === 'cookie') {
    authCookieMutationTail = settled;
  } else if (queue === 'native') {
    authNativeMutationTail = settled;
  } else {
    authStoreMutationTail = settled;
  }
  return withMutationTimeout(run, timeoutMs);
}

export function enqueueAuthStoreMutation(
  generation: number,
  mutation: () => void | Promise<void>,
  shouldRun: () => boolean = () => isAuthSessionCurrent(generation),
  timeoutMs = AUTH_MUTATION_TIMEOUT_MS,
): Promise<void> {
  return enqueueSerializedMutation(mutation, shouldRun, 'store', timeoutMs);
}

/** Serialize platform-protected background-auth writes and clears separately
 * from the app-only SecureStore queue. A slow app-store operation must not
 * indefinitely postpone native credential invalidation. */
export function enqueueAuthNativeMutation(
  generation: number,
  mutation: () => void | Promise<void>,
  shouldRun: () => boolean = () => isAuthSessionCurrent(generation),
  timeoutMs = AUTH_MUTATION_TIMEOUT_MS,
): Promise<void> {
  return enqueueSerializedMutation(mutation, shouldRun, 'native', timeoutMs);
}

export function enqueueAuthCookieMutation(
  generation: number,
  mutation: () => void | Promise<void>,
  shouldRun: () => boolean = () => isAuthSessionCurrent(generation),
  timeoutMs = AUTH_MUTATION_TIMEOUT_MS,
): Promise<void> {
  return enqueueSerializedMutation(mutation, shouldRun, 'cookie', timeoutMs);
}

/**
 * Track an operation which may write auth state after an await. Logout uses
 * this to wait for already-started operations before deleting local state.
 */
export function trackAuthSessionOperation<T>(
  generation: number,
  operation: Promise<T>,
): Promise<T> {
  const tracked: TrackedOperation = { generation, promise: Promise.resolve() };
  const promise = operation.then(
    value => {
      trackedOperations.delete(tracked);
      return value;
    },
    error => {
      trackedOperations.delete(tracked);
      throw error;
    },
  );
  tracked.promise = promise;
  trackedOperations.add(tracked);
  return promise;
}

export async function waitForAuthSessionOperations(
  invalidatedGeneration: number,
  timeoutMs = 5000,
): Promise<boolean> {
  const pending = [...trackedOperations]
    .filter(operation => operation.generation < invalidatedGeneration)
    .map(operation => operation.promise);

  if (pending.length === 0) {
    return true;
  }

  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<'timeout'>(resolve => {
    timeoutHandle = setTimeout(() => resolve('timeout'), timeoutMs);
  });
  const result = await Promise.race([
    Promise.allSettled(pending).then(() => 'complete' as const),
    timeout,
  ]);
  if (timeoutHandle) {
    clearTimeout(timeoutHandle);
  }
  return result === 'complete';
}
