import { useCallback, useMemo, useRef, useState, type ReactElement } from 'react';
import { ActivityIndicator, Alert, Text, View } from 'react-native';
import { BottomSheetFlatList } from '@gorhom/bottom-sheet';
import Avatar from '@/src/components/ui/avatar';
import { AppBottomSheet, type AppBottomSheetRef } from '@/src/components/ui/app-bottom-sheet';
import { InputV2 } from '@/src/components/ui/input-v2';
import { FilterSheetHeader } from '@/src/features/global-search/components/filters/filter-sheet-header';
import { FilterOptionRow } from '@/src/features/global-search/components/filters/filter-option-row';
import {
  useMountWhileOpen,
  type SheetMountProps,
} from '@/src/features/global-search/hooks/use-mount-while-open';
import { useUsers } from '@/src/hooks/useUsers';
import { useAuthContextValues } from '@/src/contexts/AuthContext';
import { useQuery } from '@/src/hooks/useQuery';
import { queries } from '@/src/zero/queries';
import { roomActor } from '@/src/machines/roomMachine';
import { getRecordingState } from '@/src/stores/recordingStore';
import { startAudioCall } from '@/src/utils/startAudioCall';
import { isUserDeactivated } from '@/src/utils/statusUtils';
import { buildThreadCallInvitees, defaultThreadCallInvitees } from './thread-call-invitees';

type Props = { channelId: string; threadId: string; isOpen: boolean; onClose: () => void };
export function ThreadCallSheet({ isOpen, onClose, ...ids }: Props): ReactElement | null {
  const { shouldRender, sheetProps } = useMountWhileOpen(isOpen, onClose);
  return shouldRender ? <ThreadCallSheetBody key={ids.threadId} {...ids} {...sheetProps} /> : null;
}

function ThreadCallSheetBody({
  channelId,
  threadId,
  ...sheet
}: SheetMountProps & Pick<Props, 'channelId' | 'threadId'>): ReactElement | null {
  const ref = useRef<AppBottomSheetRef>(null);
  const starting = useRef(false);
  const { userID } = useAuthContextValues();
  const users = useUsers();
  const [conversation, details] = useQuery(
    queries.getConversationById({ conversationId: threadId }),
  );
  const [members, memberDetails] = useQuery(queries.channelParticipants({ channelId }));
  const [query, setQuery] = useState('');
  const [draft, setDraft] = useState<string[] | null>(null);
  const defaults = useMemo(
    () => defaultThreadCallInvitees(conversation?.participants ?? [], userID),
    [conversation?.participants, userID],
  );
  const selected = draft ?? defaults;
  const selectedIds = useMemo(() => new Set(selected), [selected]);
  const ready =
    details.type === 'complete' &&
    memberDetails.type === 'complete' &&
    !!conversation &&
    !conversation.callId &&
    !!userID;
  const rows = useMemo(() => {
    const memberIds = new Set(members?.map(p => p.userId));
    const normalized = query.trim().toLowerCase();
    return users
      .filter(
        user =>
          user.id !== userID &&
          !isUserDeactivated(user) &&
          (memberIds.has(user.id) || selectedIds.has(user.id)),
      )
      .map(user => ({
        id: user.id,
        title: user.displayName || user.name || user.email || user.id,
        subtitle: user.email ?? '',
      }))
      .filter(user => `${user.title} ${user.subtitle}`.toLowerCase().includes(normalized))
      .sort(
        (a, b) =>
          Number(selectedIds.has(b.id)) - Number(selectedIds.has(a.id)) ||
          a.title.localeCompare(b.title),
      );
  }, [members, users, userID, query, selectedIds]);
  const start = useCallback((): void => {
    if (!ready || conversation?.callId || starting.current) return;
    const recording = getRecordingState().status;
    if (
      !roomActor.getSnapshot().matches('idle') ||
      (recording !== 'idle' && recording !== 'error')
    ) {
      Alert.alert('Call unavailable', 'Please finish your current call or recording first.');
      return;
    }
    starting.current = true;
    void startAudioCall(channelId, threadId, buildThreadCallInvitees(selected, userID));
    ref.current?.dismiss();
  }, [ready, conversation?.callId, channelId, threadId, selected, userID]);
  return (
    <AppBottomSheet ref={ref} {...sheet} mode='fullscreen' keyboardBehavior='extend'>
      <FilterSheetHeader
        title='Start thread call'
        onCancel={() => ref.current?.dismiss()}
        {...(ready ? { onApply: start, applyLabel: 'Start' } : {})}
      />
      <View className='flex-1 px-4 pt-3' style={{ minHeight: 0 }}>
        <Text className='mb-3 text-sm text-bottomsheet-text-muted'>
          Thread participants and subscribers are selected. Add other channel members or change who
          to invite.
        </Text>
        <InputV2
          variant='bottomsheet'
          value={query}
          onChangeText={setQuery}
          placeholder='Search participants'
          autoCapitalize='none'
          autoCorrect={false}
        />
        <Text className='py-3 text-sm text-bottomsheet-text-muted'>
          {selected.length} selected · You will also join
        </Text>
        {conversation?.callId ? (
          <Text className='py-3 text-bottomsheet-text-muted'>
            This thread already has a call or recording.
          </Text>
        ) : !ready ? (
          <ActivityIndicator accessibilityLabel='Loading thread participants' />
        ) : null}
        <BottomSheetFlatList
          style={{ flex: 1 }}
          data={rows}
          keyExtractor={item => item.id}
          keyboardShouldPersistTaps='handled'
          contentContainerStyle={{ paddingBottom: 32 }}
          renderItem={({ item }) => (
            <FilterOptionRow
              leading={<Avatar userIds={[item.id]} size={36} />}
              title={item.title}
              subtitle={item.subtitle}
              query={query}
              isSelected={selectedIds.has(item.id)}
              onPress={() =>
                ready &&
                setDraft(
                  selectedIds.has(item.id)
                    ? selected.filter(id => id !== item.id)
                    : [...selected, item.id],
                )
              }
            />
          )}
          ListEmptyComponent={
            <Text className='py-6 text-center text-bottomsheet-text-muted'>
              {query
                ? 'No matching participants'
                : 'No other participants. You can start the call yourself.'}
            </Text>
          }
        />
      </View>
    </AppBottomSheet>
  );
}
