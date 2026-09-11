import { create } from 'zustand';

export interface SdlcDebuggerTarget {
  source: 'sdlc';
  repoId: string;
  executionId: string;
  conversationId: string;
  sessionId: string | null;
  running: boolean;
}

interface ExternalDebuggerStore {
  target: SdlcDebuggerTarget | null;
  open: (target: SdlcDebuggerTarget) => void;
  update: (repoId: string, patch: Partial<Omit<SdlcDebuggerTarget, 'source' | 'repoId'>>) => void;
  close: () => void;
}

export const useExternalDebuggerStore = create<ExternalDebuggerStore>(set => ({
  target: null,
  open: target => set({ target }),
  update: (repoId, patch) =>
    set(state => {
      if (state.target?.source !== 'sdlc' || state.target.repoId !== repoId) return state;
      const changed = Object.entries(patch).some(
        ([key, value]) => state.target?.[key as keyof SdlcDebuggerTarget] !== value,
      );
      return changed ? { target: { ...state.target, ...patch } } : state;
    }),
  close: () => set({ target: null }),
}));
