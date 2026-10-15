import type { ChatInputEditingMessage } from '@/src/components/input-composer/input-composer.types';

import { assertNever } from '../machine/assertNever';
import type { MessageActionsTarget } from './MessageActionsHost';
import type { ReactionsTarget } from './ReactionsHost';
import type { ProfileActionsTarget } from './UserProfileActionsHost';

export type OverlaySheet =
  | { kind: 'closed' }
  | { kind: 'actions'; target: MessageActionsTarget }
  | { kind: 'forward'; target: MessageActionsTarget }
  | { kind: 'remind'; target: MessageActionsTarget }
  | { kind: 'reactions'; target: ReactionsTarget }
  | { kind: 'emoji'; target: ReactionsTarget }
  | { kind: 'profile'; target: ProfileActionsTarget };

export type OverlayState = {
  sheet: OverlaySheet;
  editing: ChatInputEditingMessage | null;
};

export type OverlayAction =
  | { type: 'openActions'; target: MessageActionsTarget }
  | { type: 'openForward'; target: MessageActionsTarget }
  | { type: 'openRemind'; target: MessageActionsTarget }
  | { type: 'openReactions'; target: ReactionsTarget }
  | { type: 'openEmoji'; target: ReactionsTarget }
  | { type: 'openProfile'; target: ProfileActionsTarget }
  | { type: 'closeSheet' }
  | { type: 'startEdit'; payload: ChatInputEditingMessage }
  | { type: 'cancelEdit' };

export const EMPTY_OVERLAYS: OverlayState = {
  sheet: { kind: 'closed' },
  editing: null,
};

export const overlayReducer = (state: OverlayState, action: OverlayAction): OverlayState => {
  switch (action.type) {
    case 'openActions':
      return { ...state, sheet: { kind: 'actions', target: action.target } };
    case 'openForward':
      return { ...state, sheet: { kind: 'forward', target: action.target } };
    case 'openRemind':
      return { ...state, sheet: { kind: 'remind', target: action.target } };
    case 'openReactions':
      return { ...state, sheet: { kind: 'reactions', target: action.target } };
    case 'openEmoji':
      return { ...state, sheet: { kind: 'emoji', target: action.target } };
    case 'openProfile':
      return { ...state, sheet: { kind: 'profile', target: action.target } };
    case 'closeSheet':
      return { ...state, sheet: { kind: 'closed' } };
    case 'startEdit':
      return { sheet: { kind: 'closed' }, editing: action.payload };
    case 'cancelEdit':
      return { ...state, editing: null };
    default:
      return assertNever(action);
  }
};
