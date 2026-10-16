import { useValue } from '@legendapp/state/react';
import { Check, ChevronLeft, Lock } from 'lucide-react-native';
import { useCallback, useMemo, useState, type ReactElement, type ReactNode } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { useCSSVariable } from 'uniwind';

import { SECTION_NAME_MAX_LENGTH } from '@/src/components/chat/channel-list/section-sheet-parts';
import { HashIcon } from '@/src/ui/icons';
import { cn } from '@/src/utils/cn';
import { haptics } from '@/src/utils/haptics';

import { channelAllIds$, channelRow$ } from '../state/rows-store';

export const TRAY_ROW_HEIGHT = 52;
const INDICATOR_SIZE = 22;
const CHANNEL_GLYPH_SIZE = 20;
const BUTTON_HEIGHT = 48;

/**
 * Single choice: a ring, with a dot inside when chosen.
 */
export function Radio({ selected }: { selected: boolean }): ReactElement {
  return (
    <View
      className={cn(
        'items-center justify-center rounded-full border-2',
        selected ? 'border-spaces-accent' : 'border-spaces-surface',
      )}
      style={{ width: INDICATOR_SIZE, height: INDICATOR_SIZE }}
    >
      {selected ? <View className='h-2.5 w-2.5 rounded-full bg-spaces-accent' /> : null}
    </View>
  );
}

/**
 * Multiple choice: the same circle, filled with a tick when chosen — so the
 * two kinds of list read as one family while a tick says "any number".
 */
export function CheckCircle({ checked }: { checked: boolean }): ReactElement {
  const onAccent = useCSSVariable('--color-spaces-accent-foreground') as string;

  return (
    <View
      className={cn(
        'items-center justify-center rounded-full border-2',
        checked ? 'border-spaces-accent bg-spaces-accent' : 'border-spaces-surface',
      )}
      style={{ width: INDICATOR_SIZE, height: INDICATOR_SIZE }}
    >
      {checked ? <Check size={14} color={onAccent} strokeWidth={3} /> : null}
    </View>
  );
}

type OptionRowProps = {
  label: string;
  leading: ReactNode;
  trailing?: ReactNode;
  highlighted?: boolean;
  /** Accent-coloured label, for the row that creates or destroys rather than chooses. */
  emphasis?: boolean;
  onPress: () => void;
};

/** One tappable line of a tray list. */
export function OptionRow({
  label,
  leading,
  trailing,
  highlighted = false,
  emphasis = false,
  onPress,
}: OptionRowProps): ReactElement {
  return (
    <Pressable
      accessibilityRole='button'
      accessibilityState={{ selected: highlighted }}
      onPress={() => {
        void haptics.buttonTap();
        onPress();
      }}
      className={cn('flex-row items-center rounded-2xl px-3', highlighted && 'bg-spaces-surface')}
      style={{ height: TRAY_ROW_HEIGHT }}
    >
      <View className='w-6 items-center justify-center'>{leading}</View>
      <Text
        numberOfLines={1}
        className={cn(
          'flex-1 text-[16px] font-medium ml-3',
          emphasis ? 'text-spaces-accent' : 'text-spaces-foreground',
        )}
      >
        {label}
      </Text>
      {trailing}
    </Pressable>
  );
}

/** The small muted line that opens a view: "Move #x to", "Native App". */
export function TrayTitle({ children }: { children: string }): ReactElement {
  return (
    <Text numberOfLines={1} className='px-3 pb-2 text-[14px] text-spaces-muted'>
      {children}
    </Text>
  );
}

/**
 * Back arrow and the view's title, for the views that sit one level in.
 */
export function BackHeader({ title, onBack }: { title: string; onBack: () => void }): ReactElement {
  const foreground = useCSSVariable('--color-spaces-foreground') as string;

  return (
    <View className='flex-row items-center pb-3'>
      <Pressable
        accessibilityRole='button'
        accessibilityLabel='Back'
        hitSlop={8}
        onPress={() => {
          void haptics.buttonTap();
          onBack();
        }}
        className='h-9 w-9 items-center justify-center rounded-full bg-spaces-surface'
      >
        <ChevronLeft size={20} color={foreground} strokeWidth={2} />
      </Pressable>
      <Text numberOfLines={1} className='flex-1 pl-3 text-[14px] text-spaces-muted'>
        {title}
      </Text>
    </View>
  );
}

type NameInputProps = {
  value: string;
  onChangeText: (value: string) => void;
  onSubmitEditing: () => void;
  placeholder?: string;
  error?: string | null;
};

/** The pill-shaped text field the section views share. */
export function NameInput({
  value,
  onChangeText,
  onSubmitEditing,
  placeholder = 'Name the section',
  error = null,
}: NameInputProps): ReactElement {
  const placeholderColor = useCSSVariable('--color-spaces-muted') as string;

  return (
    <View>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={placeholderColor}
        maxLength={SECTION_NAME_MAX_LENGTH}
        autoCapitalize='sentences'
        returnKeyType='done'
        onSubmitEditing={onSubmitEditing}
        accessibilityLabel={placeholder}
        className='h-11 rounded-full bg-spaces-surface px-4 text-[16px] text-spaces-foreground'
      />
      {error !== null ? (
        <Text className='px-4 pt-2 text-[13px] text-spaces-accent'>{error}</Text>
      ) : null}
    </View>
  );
}

type ButtonProps = {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  /** `neutral` is the quiet counterpart, like Cancel beside Delete. */
  tone?: 'accent' | 'neutral';
};

/** A full-width pill; dims to the surface colour when it cannot be pressed. */
export function PillButton({
  label,
  onPress,
  disabled = false,
  tone = 'accent',
}: ButtonProps): ReactElement {
  const onAccent = useCSSVariable('--color-spaces-accent-foreground') as string;
  const isAccent = tone === 'accent' && !disabled;

  return (
    <Pressable
      accessibilityRole='button'
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      className={cn(
        'items-center justify-center rounded-full',
        isAccent ? 'bg-spaces-accent' : 'bg-spaces-surface',
      )}
      style={{ height: BUTTON_HEIGHT }}
    >
      <Text
        className={cn(
          'text-[16px] font-semibold',
          !isAccent && (disabled ? 'text-spaces-muted' : 'text-spaces-foreground'),
        )}
        style={isAccent ? { color: onAccent } : undefined}
      >
        {label}
      </Text>
    </Pressable>
  );
}

type ChannelOptionProps = {
  id: string;
  checked: boolean;
  onToggle: (id: string) => void;
};

/** One channel in a multi-select list. */
export function ChannelOption({ id, checked, onToggle }: ChannelOptionProps): ReactElement {
  const name = useValue(() => channelRow$(id).name.get());
  const isPrivate = useValue(() => channelRow$(id).isPrivate.get());
  const muted = useCSSVariable('--color-spaces-muted') as string;

  return (
    <OptionRow
      label={name ?? ''}
      highlighted={checked}
      leading={
        isPrivate ? (
          <Lock size={CHANNEL_GLYPH_SIZE} color={muted} strokeWidth={2} />
        ) : (
          <HashIcon size={CHANNEL_GLYPH_SIZE} color={muted} />
        )
      }
      trailing={<CheckCircle checked={checked} />}
      onPress={() => onToggle(id)}
    />
  );
}

/**
 * Every channel id, alphabetically and optionally narrowed by a query.
 *
 * Alphabetical so the list does not reshuffle under the finger as activity
 * arrives while a tray is open.
 */
export function useChannelIds(query = ''): string[] {
  const allIds = useValue(channelAllIds$);
  const sorted = useMemo(
    () =>
      [...allIds].sort((a, b) =>
        (channelRow$(a).name.peek() ?? '').localeCompare(channelRow$(b).name.peek() ?? ''),
      ),
    [allIds],
  );

  return useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (needle.length === 0) return sorted;
    return sorted.filter(id => (channelRow$(id).name.peek() ?? '').toLowerCase().includes(needle));
  }, [query, sorted]);
}

/** A set of ticked channel ids with a stable toggle. */
export function useChannelSelection(
  initial: Iterable<string> = [],
): readonly [ReadonlySet<string>, (id: string) => void] {
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set(initial));

  const toggle = useCallback((id: string) => {
    void haptics.toggleOn();
    setSelected(current => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  return [selected, toggle] as const;
}
