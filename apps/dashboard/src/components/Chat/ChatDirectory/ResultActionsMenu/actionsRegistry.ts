/**
 * Registry of secondary actions offered on a highlighted Cmd+K user/channel result (the ⌥↵ Actions
 * menu). Each entry maps to a `/`-command `kind` that `useSlashCommands.invokeActionOnTarget` runs,
 * so the menu never re-implements chat/call logic. To add an action (Go to, Copy link, …), add one
 * entry here — the menu renders from this list, no component changes.
 */
import { MessageSquare, Phone, type LucideIcon } from 'lucide-react';

// The slash-command kinds the Actions menu can dispatch (picker commands only).
export type ResultActionKind = 'chat' | 'call';

export interface ResultAction {
  id: 'message' | 'call';
  label: string;
  icon: LucideIcon;
  // Which `invokeActionOnTarget` kind to run when picked.
  kind: ResultActionKind;
}

export const RESULT_ACTIONS: ResultAction[] = [
  { id: 'message', label: 'Message', icon: MessageSquare, kind: 'chat' },
  { id: 'call', label: 'Call', icon: Phone, kind: 'call' },
];
