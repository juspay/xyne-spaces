import { useState, type ReactElement } from 'react';
import { ActivityIndicator, Alert, Pressable, Text, View } from 'react-native';
import { BottomSheetFlatList, BottomSheetTextInput } from '@gorhom/bottom-sheet';
import { Pencil, Pin, PinOff, Trash2 } from 'lucide-react-native';
import { useCSSVariable } from 'uniwind';

import { AppBottomSheet } from '@/src/components/ui/app-bottom-sheet';
import { SearchBar } from '@/src/components/ui/search-bar';
import { ListRow, ListRowDivider } from '@/src/components/ui/settings-list';
import { haptics } from '@/src/utils/haptics';
import { FilterSheetHeader } from '@/src/features/global-search/components/filters/filter-sheet-header';
import {
  useMountWhileOpen,
  type SheetMountProps,
} from '@/src/features/global-search/hooks/use-mount-while-open';

import type { ConversationSummary } from '../api/xyneAIConversations';
import { useXyneAIConversations } from '../hooks/useXyneAIConversations';
import { filterByTitle, groupConversations } from '../model/conversationGroups';
import { PickerSheet, SheetCard, useAfterDismiss, useSheetBottomPadding } from './PickerSheet';

type Item = { header: string } | { conversation: ConversationSummary };

const ConversationRow = ({
  conversation,
  isRenaming,
  isRunning,
  onOpen,
  onShowActions,
  onRename,
}: {
  conversation: ConversationSummary;
  isRenaming: boolean;
  isRunning: boolean;
  onOpen: () => void;
  onShowActions: () => void;
  onRename: (title: string) => void;
}): ReactElement => {
  const muted = useCSSVariable('--color-secondary-foreground') as string;
  const title = conversation.title || 'New chat';

  return isRenaming ? (
    <BottomSheetTextInput
      ref={(input): void => input?.focus()}
      selectTextOnFocus
      defaultValue={title}
      returnKeyType='done'
      onSubmitEditing={({ nativeEvent }): void => onRename(nativeEvent.text)}
      onBlur={(): void => onRename(title)}
      className='mx-4 rounded-xl border border-border px-3 py-2.5 text-[15px] text-foreground'
    />
  ) : (
    <Pressable
      accessibilityRole='button'
      accessibilityHint='Long press for more options'
      onPress={onOpen}
      onLongPress={(): void => {
        void haptics.buttonTap();
        onShowActions();
      }}
      className='min-h-12 flex-row items-center gap-2 px-5 py-3 active:bg-secondary'
    >
      <Text numberOfLines={1} className='min-w-0 flex-1 text-[15px] text-foreground'>
        {title}
      </Text>
      {isRunning ? <Text className='text-[11px] text-brand'>Responding</Text> : null}
      {conversation.pinned ? <Pin size={14} color={muted} /> : null}
    </Pressable>
  );
};

function ConversationHistoryBody({
  isOpen,
  onOpenChange,
  onDismiss,
  onOpenConversation,
  onDeleted,
  runningConversationId,
}: SheetMountProps & {
  onOpenConversation: (conversation: ConversationSummary) => void;
  onDeleted: (conversationId: string) => void;
  runningConversationId: string | undefined;
}): ReactElement {
  const { list, update, remove } = useXyneAIConversations();
  const [query, setQuery] = useState('');
  const [renamingId, setRenamingId] = useState<string>();
  // Kept after closing so the sheet's content stays put while it animates away.
  const [actionsFor, setActionsFor] = useState<ConversationSummary>();
  const [isActionsOpen, setIsActionsOpen] = useState(false);
  const actionsDismiss = useAfterDismiss();
  const paddingBottom = useSheetBottomPadding();

  const items: Item[] = groupConversations(filterByTitle(list.data ?? [], query)).flatMap(group => [
    { header: group.label },
    ...group.conversations.map(conversation => ({ conversation })),
  ]);

  const confirmDelete = (conversation: ConversationSummary): void =>
    Alert.alert('Delete chat?', conversation.title, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: (): void =>
          remove.mutate(conversation, {
            onSuccess: () => onDeleted(conversation.conversationId),
          }),
      },
    ]);

  const rename = (conversation: ConversationSummary, text: string): void => {
    const title = text.trim();
    setRenamingId(undefined);
    if (title && title !== conversation.title) update.mutate({ conversation, patch: { title } });
  };

  return (
    <AppBottomSheet
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      onDismiss={onDismiss}
      mode='fullscreen'
      backdropOpacity={0.4}
    >
      <FilterSheetHeader title='History' />
      <SearchBar value={query} onChangeText={setQuery} containerClassName='mx-4 mb-1' />
      {list.isPending ? (
        <ActivityIndicator className='mt-8' />
      ) : (
        <BottomSheetFlatList
          data={items}
          keyExtractor={item => ('header' in item ? item.header : item.conversation.rowId)}
          renderItem={({ item }): ReactElement =>
            'header' in item ? (
              <Text className='px-5 pb-1 pt-4 text-[13px] font-medium text-bottomsheet-text-muted'>
                {item.header}
              </Text>
            ) : (
              <ConversationRow
                conversation={item.conversation}
                isRenaming={renamingId === item.conversation.rowId}
                isRunning={item.conversation.conversationId === runningConversationId}
                onOpen={(): void => onOpenConversation(item.conversation)}
                onShowActions={(): void => {
                  setActionsFor(item.conversation);
                  setIsActionsOpen(true);
                }}
                onRename={(text): void => rename(item.conversation, text)}
              />
            )
          }
          ListEmptyComponent={
            <View className='py-8'>
              <Text className='text-center text-bottomsheet-text-muted'>
                {query ? 'No matching chats' : 'No chats yet'}
              </Text>
            </View>
          }
          onEndReached={(): void => {
            if (list.hasNextPage && !list.isFetchingNextPage) void list.fetchNextPage();
          }}
          keyboardShouldPersistTaps='handled'
          contentContainerStyle={{ paddingBottom }}
        />
      )}
      <PickerSheet
        isOpen={isActionsOpen}
        onOpenChange={setIsActionsOpen}
        onDismiss={actionsDismiss.onDismiss}
        title={actionsFor?.title || 'New chat'}
      >
        {actionsFor ? (
          <SheetCard>
            <ListRow
              icon={Pencil}
              label='Rename'
              onPress={(): void => {
                setIsActionsOpen(false);
                setRenamingId(actionsFor.rowId);
              }}
            />
            <ListRowDivider />
            <ListRow
              icon={actionsFor.pinned ? PinOff : Pin}
              label={actionsFor.pinned ? 'Unpin' : 'Pin'}
              onPress={(): void => {
                setIsActionsOpen(false);
                update.mutate({ conversation: actionsFor, patch: { pinned: !actionsFor.pinned } });
              }}
            />
            <ListRowDivider />
            <ListRow
              icon={Trash2}
              label='Delete'
              destructive
              onPress={(): void => {
                actionsDismiss.afterDismiss(() => confirmDelete(actionsFor));
                setIsActionsOpen(false);
              }}
            />
          </SheetCard>
        ) : null}
      </PickerSheet>
    </AppBottomSheet>
  );
}

export function ConversationHistorySheet({
  isOpen,
  onClose,
  onOpenConversation,
  onDeleted,
  runningConversationId,
}: {
  isOpen: boolean;
  onClose: () => void;
  onOpenConversation: (conversation: ConversationSummary) => void;
  onDeleted: (conversationId: string) => void;
  /** The chat on screen while its answer is still being written. */
  runningConversationId: string | undefined;
}): ReactElement | null {
  const { shouldRender, sheetProps } = useMountWhileOpen(isOpen, onClose);
  return shouldRender ? (
    <ConversationHistoryBody
      {...sheetProps}
      onOpenConversation={onOpenConversation}
      onDeleted={onDeleted}
      runningConversationId={runningConversationId}
    />
  ) : null;
}
