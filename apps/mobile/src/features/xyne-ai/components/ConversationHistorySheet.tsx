import { useState, type ReactElement } from 'react';
import { ActivityIndicator, Alert, Pressable, Text, View } from 'react-native';
import { BottomSheetFlatList, BottomSheetTextInput } from '@gorhom/bottom-sheet';
import { MenuView } from '@react-native-menu/menu';
import { Pin } from 'lucide-react-native';
import { useCSSVariable } from 'uniwind';

import { AppBottomSheet } from '@/src/components/ui/app-bottom-sheet';
import { FilterSheetHeader } from '@/src/features/global-search/components/filters/filter-sheet-header';
import {
  useMountWhileOpen,
  type SheetMountProps,
} from '@/src/features/global-search/hooks/use-mount-while-open';

import type { ConversationSummary } from '../api/xyneAIConversations';
import { useXyneAIConversations } from '../hooks/useXyneAIConversations';
import { groupConversations } from '../model/conversationGroups';

type Item = { header: string } | { conversation: ConversationSummary };

const ConversationRow = ({
  conversation,
  isRenaming,
  onOpen,
  onRename,
  onStartRename,
  onTogglePin,
  onDelete,
}: {
  conversation: ConversationSummary;
  isRenaming: boolean;
  onOpen: () => void;
  onRename: (title: string) => void;
  onStartRename: () => void;
  onTogglePin: () => void;
  onDelete: () => void;
}): ReactElement => {
  const muted = useCSSVariable('--color-secondary-foreground') as string;
  const title = conversation.title || 'New chat';

  return (
    <MenuView
      shouldOpenOnLongPress
      actions={[
        { id: 'rename', title: 'Rename' },
        { id: 'pin', title: conversation.pinned ? 'Unpin' : 'Pin' },
        { id: 'delete', title: 'Delete', attributes: { destructive: true } },
      ]}
      onPressAction={({ nativeEvent }): void => {
        if (nativeEvent.event === 'rename') onStartRename();
        else if (nativeEvent.event === 'pin') onTogglePin();
        else onDelete();
      }}
    >
      {isRenaming ? (
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
          onPress={onOpen}
          className='flex-row items-center gap-2 px-5 py-3 active:opacity-60'
        >
          <Text numberOfLines={1} className='min-w-0 flex-1 text-[15px] text-foreground'>
            {title}
          </Text>
          {conversation.pinned ? <Pin size={14} color={muted} /> : null}
        </Pressable>
      )}
    </MenuView>
  );
};

function ConversationHistoryBody({
  isOpen,
  onOpenChange,
  onDismiss,
  onOpenConversation,
  onDeleted,
}: SheetMountProps & {
  onOpenConversation: (conversation: ConversationSummary) => void;
  onDeleted: (conversationId: string) => void;
}): ReactElement {
  const { list, update, remove } = useXyneAIConversations();
  const [renamingId, setRenamingId] = useState<string>();

  const items: Item[] = groupConversations(list.data ?? []).flatMap(group => [
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
                onOpen={(): void => onOpenConversation(item.conversation)}
                onRename={(text): void => rename(item.conversation, text)}
                onStartRename={(): void => setRenamingId(item.conversation.rowId)}
                onTogglePin={(): void =>
                  update.mutate({
                    conversation: item.conversation,
                    patch: { pinned: !item.conversation.pinned },
                  })
                }
                onDelete={(): void => confirmDelete(item.conversation)}
              />
            )
          }
          ListEmptyComponent={
            <View className='py-8'>
              <Text className='text-center text-bottomsheet-text-muted'>No chats yet</Text>
            </View>
          }
          onEndReached={(): void => {
            if (list.hasNextPage && !list.isFetchingNextPage) void list.fetchNextPage();
          }}
          keyboardShouldPersistTaps='handled'
        />
      )}
    </AppBottomSheet>
  );
}

export function ConversationHistorySheet({
  isOpen,
  onClose,
  onOpenConversation,
  onDeleted,
}: {
  isOpen: boolean;
  onClose: () => void;
  onOpenConversation: (conversation: ConversationSummary) => void;
  onDeleted: (conversationId: string) => void;
}): ReactElement | null {
  const { shouldRender, sheetProps } = useMountWhileOpen(isOpen, onClose);
  return shouldRender ? (
    <ConversationHistoryBody
      {...sheetProps}
      onOpenConversation={onOpenConversation}
      onDeleted={onDeleted}
    />
  ) : null;
}
