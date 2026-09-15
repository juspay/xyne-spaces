import { create } from 'zustand';

interface DiagnosticsPanelStore {
  open: boolean;
  show: () => void;
  hide: () => void;
  toggle: () => void;
}

/**
 * Open/closed state for the performance diagnostics side panel.
 *
 * Kept in a store rather than local component state because the shortcut that
 * toggles it lives above the router, while the panel itself renders inside
 * AppRoot's resizable group.
 */
export const useDiagnosticsPanelStore = create<DiagnosticsPanelStore>(set => ({
  open: false,
  show: () => set({ open: true }),
  hide: () => set({ open: false }),
  toggle: () => set(state => ({ open: !state.open })),
}));
