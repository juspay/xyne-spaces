import type { LogFields, NormalizedLogFields } from '../types';

export interface LogContextStore {
  snapshot(): NormalizedLogFields;
}

export interface MutableLogContextStore extends LogContextStore {
  set(fields: LogFields): void;
  unset(keys: readonly string[]): void;
}
