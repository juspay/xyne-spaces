import type { ChatComposerDockProps } from '../composer/ChatComposerDock';
import type { OpenIntent } from '../intent/openIntent.types';
import type { ListMetrics, OpenState } from '../machine/openState';
import type { ChatRow } from '../model/chatRow.types';
import type { ChatMessageRow } from './landing';

export type ConversationComposer = Omit<ChatComposerDockProps, 'composerRef' | 'onComposerLayout'>;

export type RowEventKind = 'press' | 'longPress' | 'avatar' | 'reactions';

export type ListEvent =
  | { type: 'landingConfirmed'; metrics: ListMetrics }
  | { type: 'userTookOwnership' }
  | { type: 'retry' }
  | { type: 'openLatest' }
  | { type: 'visible'; row: { conversationId: string; createdAt: number } | null; atEnd: boolean };

export type ConversationListProps = {
  surface: OpenIntent['surface'];
  state: OpenState;
  rows: readonly ChatRow[];
  composer: ConversationComposer;
  hasReachedStart: boolean;
  onPaginate: (edge: 'older' | 'newer') => void;
  onRowEvent: (kind: RowEventKind, row: ChatMessageRow) => void;
  onListEvent: (event: ListEvent) => void;
};
