import type { WorkspaceItem, WorkspaceItemSource } from '../itemDescriptor';

export interface PassageSelection {
  text: string;
  url: string;
  title: string;
  provider?: string;
  intent: 'ask' | 'edit';
  /** Typed alongside the pick; when absent the passage waits on the composer. */
  question?: string;
}

export interface SelectionSink {
  send: (selection: PassageSelection) => void;
}

const sinks = new Map<WorkspaceItemSource, SelectionSink>();

/**
 * Where "Ask with Xyne" sends a picked passage. Each surface registers its own
 * destination — the AI screen its composer, a hub its conversation panel — and
 * the button simply does not render where nothing is registered.
 */
export function registerSelectionSink(source: WorkspaceItemSource, sink: SelectionSink): void {
  sinks.set(source, sink);
}

export function selectionSinkFor(item: WorkspaceItem): SelectionSink | null {
  return sinks.get(item.source) ?? null;
}
