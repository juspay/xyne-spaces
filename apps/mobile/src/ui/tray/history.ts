/**
 * View history, as a pure reducer.
 *
 * A stack rather than `{current, previous}` so `Customize → Confirm → back`
 * works with no special case, and so the depth is the only thing `canGoBack`
 * has to look at.
 */
export type TrayState = {
  visible: boolean;
  /** Last entry is the current view. Never empty while visible. */
  stack: string[];
};

export type TrayAction =
  | { type: 'open'; view?: string | undefined }
  | { type: 'close' }
  | { type: 'setView'; id: string }
  | { type: 'goBack' };

export function initialTrayState(defaultView: string): TrayState {
  return { visible: false, stack: [defaultView] };
}

export function trayReducer(state: TrayState, action: TrayAction, defaultView: string): TrayState {
  switch (action.type) {
    case 'open':
      // Opening to a named view resets history: an entry point is a root, not a
      // continuation of wherever the tray happened to be last time.
      return { visible: true, stack: [action.view ?? defaultView] };

    case 'close':
      // The stack is reset on close rather than on open, so the exit animation
      // still has a view to render on its way out.
      return { ...state, visible: false };

    case 'setView':
      if (state.stack[state.stack.length - 1] === action.id) return state;
      return { ...state, stack: [...state.stack, action.id] };

    case 'goBack':
      if (state.stack.length <= 1) return state;
      return { ...state, stack: state.stack.slice(0, -1) };
  }
}

export function currentView(state: TrayState, defaultView: string): string {
  return state.stack[state.stack.length - 1] ?? defaultView;
}

export function canGoBack(state: TrayState): boolean {
  return state.stack.length > 1;
}
