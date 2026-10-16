import { normalizeLogFields } from '../normalizeLogFields';
import type { JsonValue, LogFields, NormalizedLogFields } from '../types';
import type { MutableLogContextStore } from './LogContextStore';

export class InMemoryLogContextStore implements MutableLogContextStore {
  private fields: NormalizedLogFields = {};

  snapshot(): NormalizedLogFields {
    return { ...this.fields };
  }

  set(fields: LogFields): void {
    this.fields = {
      ...this.fields,
      ...normalizeLogFields(fields),
    };
  }

  unset(keys: readonly string[]): void {
    const next: Record<string, JsonValue> = { ...this.fields };

    for (const key of keys) {
      delete next[key];
    }

    this.fields = next;
  }
}
