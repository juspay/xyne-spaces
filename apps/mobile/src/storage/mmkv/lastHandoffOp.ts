import { AppState } from 'react-native';

import { diagMmkv } from './instances';
import {
  hashMmkvKey,
  isSharedStoreFallbackAllowed,
  isSuspendEligible,
} from './lastHandoffOpPolicy';

export type HandoffOp = 'get' | 'set' | 'remove' | 'getAllKeys';

export type HandoffLastOp = {
  ts: number;
  op: HandoffOp;
  caller: string;
  keyHash: string;
  appState: 'active' | 'inactive' | 'background' | 'unknown';
  runtime: 'main' | 'headless' | 'unknown';
};

export {
  hashMmkvKey,
  isSharedStoreFallbackAllowed,
  isSuspendEligible,
  shouldPublishHandoffLastOp,
  HANDOFF_LAST_OP_RECENT_MS,
} from './lastHandoffOpPolicy';

const LAST_OP_KEY = 'handoff_last_op';

type CallerFrame = { caller: string; id: number };

const callerStack: CallerFrame[] = [{ caller: 'app', id: 0 }];
let nextCallerId = 1;

export function withMmkvCaller<T>(caller: string, fn: () => T): T {
  const frame: CallerFrame = { caller, id: nextCallerId++ };
  callerStack.push(frame);
  const removeFrame = (): void => {
    for (let index = callerStack.length - 1; index >= 0; index -= 1) {
      if (callerStack[index]?.id === frame.id) {
        callerStack.splice(index, 1);
        return;
      }
    }
  };

  let thenable = false;
  try {
    const result = fn();
    if (
      result !== null &&
      result !== undefined &&
      typeof (result as { then?: unknown }).then === 'function'
    ) {
      thenable = true;
      return Promise.resolve(result).finally(removeFrame) as T;
    }
    return result;
  } finally {
    if (!thenable) {
      removeFrame();
    }
  }
}

function currentCaller(): string {
  return callerStack[callerStack.length - 1]?.caller ?? 'app';
}

function mapAppState(): HandoffLastOp['appState'] {
  const value = AppState.currentState;
  if (value === 'active' || value === 'inactive' || value === 'background') {
    return value;
  }
  return 'unknown';
}

function currentRuntime(): HandoffLastOp['runtime'] {
  return globalThis.__XYNE_HEADLESS__ === true ? 'headless' : 'main';
}

export function shouldUseSharedStoreFallback(): boolean {
  return isSharedStoreFallbackAllowed({
    appState: mapAppState(),
    runtime: currentRuntime(),
  });
}

export function recordHandoffOp<T>(op: HandoffOp, key: string, fn: () => T): T {
  const record: HandoffLastOp = {
    ts: Date.now(),
    op,
    caller: currentCaller(),
    keyHash: hashMmkvKey(key),
    appState: mapAppState(),
    runtime: currentRuntime(),
  };

  if (isSuspendEligible(record)) {
    try {
      diagMmkv.set(LAST_OP_KEY, JSON.stringify(record));
    } catch {
      // RCA must never block App Group I/O.
    }
  }

  return fn();
}

const HANDOFF_OPS: ReadonlySet<string> = new Set(['get', 'set', 'remove', 'getAllKeys']);
const APP_STATES: ReadonlySet<string> = new Set(['active', 'inactive', 'background', 'unknown']);
const RUNTIMES: ReadonlySet<string> = new Set(['main', 'headless', 'unknown']);

export function loadHandoffLastOp(): HandoffLastOp | null {
  try {
    const raw = diagMmkv.getString(LAST_OP_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<HandoffLastOp>;
    if (
      typeof parsed.ts !== 'number' ||
      !HANDOFF_OPS.has(parsed.op ?? '') ||
      typeof parsed.caller !== 'string' ||
      typeof parsed.keyHash !== 'string' ||
      !APP_STATES.has(parsed.appState ?? '') ||
      !RUNTIMES.has(parsed.runtime ?? '')
    ) {
      return null;
    }
    return parsed as HandoffLastOp;
  } catch {
    return null;
  }
}
