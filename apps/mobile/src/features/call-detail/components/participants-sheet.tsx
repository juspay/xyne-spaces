import { type ReactElement } from 'react';
import { Text, View } from 'react-native';
import { BottomSheetScrollView } from '@gorhom/bottom-sheet';

import Avatar from '@/src/components/ui/avatar';
import { AppBottomSheet } from '@/src/components/ui/app-bottom-sheet';

import type { RosterParticipant } from '../hooks/use-call-timeline';

const formatTime = (ms: number): string =>
  new Date(ms).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });

function attendance(participant: RosterParticipant): string {
  if (participant.joinedAtMs === null) {
    return participant.response === 'DECLINED' ? 'Declined' : "Invited · didn't join";
  }
  const joined = `Joined ${formatTime(participant.joinedAtMs)}`;
  return participant.leftAtMs !== null
    ? `${joined} · Left ${formatTime(participant.leftAtMs)}`
    : joined;
}

export function ParticipantsSheet({
  isOpen,
  onClose,
  participants,
}: {
  isOpen: boolean;
  onClose: () => void;
  participants: RosterParticipant[];
}): ReactElement {
  const attended = participants.filter(p => p.joinedAtMs !== null).length;
  return (
    <AppBottomSheet isOpen={isOpen} onOpenChange={open => !open && onClose()} mode='dynamic'>
      <BottomSheetScrollView contentContainerStyle={{ paddingBottom: 32 }}>
        <View className='px-5 pt-1 pb-3'>
          <Text className='text-lg font-semibold text-foreground'>Participants</Text>
          <Text className='text-[13px] text-secondary-foreground mt-0.5'>
            {`${participants.length} invited · ${attended} joined`}
          </Text>
        </View>
        {participants.map(participant => (
          <View key={participant.userId} className='flex-row items-center gap-3 px-5 py-2.5'>
            <Avatar
              userIds={[participant.userId]}
              fallbackUsers={[
                {
                  id: participant.userId,
                  name: participant.name,
                  picture: participant.picture,
                },
              ]}
              size={38}
            />
            <View className='flex-1 min-w-0'>
              <View className='flex-row items-center gap-1.5'>
                <Text className='text-[15px] font-medium text-foreground shrink' numberOfLines={1}>
                  {participant.name}
                  {participant.isSelf ? (
                    <Text className='text-secondary-foreground font-normal'> (you)</Text>
                  ) : null}
                </Text>
                {participant.isHost ? (
                  <View className='rounded-md bg-secondary px-1.5 py-0.5'>
                    <Text className='text-[10.5px] font-semibold uppercase tracking-wide text-secondary-foreground'>
                      Host
                    </Text>
                  </View>
                ) : null}
              </View>
              <Text className='text-[12.5px] text-secondary-foreground mt-0.5' numberOfLines={1}>
                {attendance(participant)}
              </Text>
            </View>
          </View>
        ))}
      </BottomSheetScrollView>
    </AppBottomSheet>
  );
}
