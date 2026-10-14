type Listener = () => void;

const listeners = new Set<Listener>();

/** Dismisses any open DM-row context menu, on either platform. */
export function dismissDmListContextMenus(): void {
  for (const listener of listeners) {
    listener();
  }
}

export function subscribeDmListContextMenus(listener: Listener): () => void {
  listeners.add(listener);
  return (): void => {
    listeners.delete(listener);
  };
}
