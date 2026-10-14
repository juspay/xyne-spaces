import { memo, type ReactElement } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Building2, Hash, Plus, X } from 'lucide-react-native';
import { useCSSVariable } from 'uniwind';

import Avatar from '@/src/components/ui/avatar';
import { SectionCard } from '@/src/components/ui/settings-list';
import { withAlpha } from '@/src/theme/accent-contrast';
import { useBubbleAccent } from '@/src/theme/useBubbleAccent';

import {
  NO_PARTICIPANTS,
  countParticipants,
  type ScheduleCallParticipants,
} from '../hooks/useScheduleCallForm';
import { CardHeader } from './CardHeader';

/** Chips shown in the strip; the rest collapse into a "+N more" tile that opens the picker. */
const MAX_CHIPS = 12;

interface ChipProps {
  leading: ReactElement;
  label: string;
  onRemove: () => void;
  locked?: boolean;
}

/** A selected recipient: round picture, a remove badge on its corner, and the name below. */
const Chip = ({ leading, label, onRemove, locked = false }: ChipProps): ReactElement => {
  const foreground = useCSSVariable('--color-foreground') as string;
  return (
    <View className='w-18 items-center gap-2 pt-0.5'>
      <View>
        {leading}
        {locked ? null : (
          <Pressable
            accessibilityRole='button'
            accessibilityLabel={`Remove ${label}`}
            hitSlop={10}
            onPress={onRemove}
            className='absolute -right-1 -top-1.5 size-5 items-center justify-center rounded-full border-2 border-settings-section-bg bg-accent'
          >
            <X size={10} strokeWidth={3.4} color={foreground} />
          </Pressable>
        )}
      </View>
      <Text className='w-full text-center text-xs text-foreground' numberOfLines={2}>
        {label}
      </Text>
    </View>
  );
};

const PLACEHOLDER_SLOTS = [0, 1, 2];

/** An empty slot: a muted circle and two name bars, in the shape a selected person will take. */
const PlaceholderSlot = ({ onPress }: { onPress: () => void }): ReactElement => (
  <Pressable
    accessibilityRole='button'
    accessibilityLabel='Add people'
    onPress={onPress}
    className='w-18 items-center gap-2 pt-0.5 opacity-60 active:opacity-80'
  >
    <View className='size-13 rounded-full bg-secondary' />
    <View className='items-center gap-1.5'>
      <View className='h-2 w-14 rounded-full bg-secondary' />
      <View className='h-2 w-9 rounded-full bg-secondary' />
    </View>
  </Pressable>
);

const RoundTile = ({ children }: { children: ReactElement }): ReactElement => (
  <View className='size-13 items-center justify-center rounded-full bg-secondary'>{children}</View>
);

interface InternalUsersCardProps {
  participants: ScheduleCallParticipants;
  onChange: (participants: ScheduleCallParticipants) => void;
  /** Opens the people sheet (people, groups, channels). */
  onOpenPicker: () => void;
  lockedUserIds?: ReadonlySet<string> | undefined;
}

const subtitleFor = ({ users, channel }: ScheduleCallParticipants): string => {
  if (channel) return 'Whole channel';
  if (users.length === 0) return 'Pick people to invite';
  return users.length === 1 ? '1 person' : `${users.length} people · newest first`;
};

/**
 * Who is invited from the workspace: a header, then a strip that starts with an "Add" tile
 * followed by the selected people, newest first. Empty, it is just the header and the Add tile.
 */
const InternalUsersCardBase = ({
  participants,
  onChange,
  onOpenPicker,
  lockedUserIds,
}: InternalUsersCardProps): ReactElement => {
  const { accentText } = useBubbleAccent();
  const sectionBackground = useCSSVariable('--color-settings-section-bg') as string;
  const descriptionColor = useCSSVariable('--color-settings-description') as string;
  const { users, channel } = participants;
  const hasSelection = countParticipants(participants) > 0;

  return (
    <SectionCard className='mt-3'>
      <CardHeader
        icon={Building2}
        title='Internal'
        subtitle={subtitleFor(participants)}
        {...(hasSelection ? { action: { label: 'See all', onPress: onOpenPicker } } : {})}
      />
      <View>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          keyboardShouldPersistTaps='handled'
          contentContainerClassName='gap-0.5 px-2.5 pb-3.5 pt-1.5'
        >
          <Pressable
            accessibilityRole='button'
            accessibilityLabel='Add people'
            onPress={onOpenPicker}
            className='w-18 items-center gap-2 pt-0.5 active:opacity-70'
          >
            {/* A 1px border: React Native scales the dash length with the width, so this gives the
                short, many-dashed ring of the prototype (2px made fewer, longer dashes). */}
            <View className='size-13 items-center justify-center rounded-full border border-dashed border-border'>
              <Plus size={18} strokeWidth={2.6} color={accentText} />
            </View>
            <Text className='text-xs font-semibold' style={{ color: accentText }}>
              Add
            </Text>
          </Pressable>

          {/* Empty: placeholder slots show where people will appear; any of them opens the picker. */}
          {hasSelection
            ? null
            : PLACEHOLDER_SLOTS.map(slot => <PlaceholderSlot key={slot} onPress={onOpenPicker} />)}

          {channel ? (
            <Chip
              leading={
                <RoundTile>
                  <Hash size={20} color={descriptionColor} />
                </RoundTile>
              }
              label={channel.name}
              onRemove={() => onChange(NO_PARTICIPANTS)}
            />
          ) : null}
          {/* Newest first, capped: a big group would otherwise mount hundreds of chips. */}
          {[...users]
            .reverse()
            .slice(0, MAX_CHIPS)
            .map(user => (
              <Chip
                key={user.id}
                leading={<Avatar userIds={[user.id]} size={52} />}
                label={user.name}
                locked={!!lockedUserIds?.has(user.id)}
                onRemove={() =>
                  onChange({ ...participants, users: users.filter(u => u.id !== user.id) })
                }
              />
            ))}
          {users.length > MAX_CHIPS ? (
            <Pressable
              accessibilityRole='button'
              accessibilityLabel={`${users.length - MAX_CHIPS} more people`}
              onPress={onOpenPicker}
              className='w-18 items-center gap-2 pt-0.5 active:opacity-70'
            >
              <RoundTile>
                <Text className='text-base font-semibold text-foreground'>
                  +{users.length - MAX_CHIPS}
                </Text>
              </RoundTile>
              <Text className='text-xs text-secondary-foreground'>more</Text>
            </Pressable>
          ) : null}
        </ScrollView>
        {/* Soft fade on the right edge hints that the strip scrolls. */}
        <View className='pointer-events-none absolute inset-y-0 right-0 w-6'>
          <LinearGradient
            colors={[withAlpha(sectionBackground, 0), sectionBackground]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={StyleSheet.absoluteFill}
          />
        </View>
      </View>
    </SectionCard>
  );
};

// Props are stable between keystrokes in the title, so the card skips those re-renders.
export const InternalUsersCard = memo(InternalUsersCardBase);
