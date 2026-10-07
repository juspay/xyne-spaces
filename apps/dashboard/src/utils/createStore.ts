/** The listeners of a module-level store, as useSyncExternalStore subscribes to them. */
export interface Store {
  subscribe: (listener: () => void) => () => void;
  notify: () => void;
}

export const createStore = (): Store => {
  const listeners = new Set<() => void>();
  return {
    subscribe: listener => {
      listeners.add(listener);
      return (): void => {
        listeners.delete(listener);
      };
    },
    notify: () => listeners.forEach(listener => listener()),
  };
};
