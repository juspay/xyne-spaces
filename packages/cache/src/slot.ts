/** The only mutable state for cached data: a single value, replaced whole. */
export type Slot<T> = {
  current(): T | undefined;
  swap(next: T): void;
  clear(): void;
};

export function createSlot<T>(): Slot<T> {
  let value: T | undefined;
  return {
    current: () => value,
    swap: (next) => {
      value = next;
    },
    clear: () => {
      value = undefined;
    },
  };
}
