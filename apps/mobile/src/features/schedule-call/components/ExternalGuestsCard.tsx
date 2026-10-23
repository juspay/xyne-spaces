import { memo, useEffect, useState, type ReactElement } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { Globe, Mail, X } from 'lucide-react-native';
import { useCSSVariable } from 'uniwind';

import { ListRowDivider, SectionCard } from '@/src/components/ui/settings-list';
import { useBubbleAccent } from '@/src/theme/useBubbleAccent';
import { haptics } from '@/src/utils/haptics';

import { CardHeader } from './CardHeader';

// Same address check and normalisation as the dashboard's ExternalInviteesInput.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Turns `Alice <alice@example.com>` or `alice@example.com` into a plain lowercase address. */
function normalize(s: string): string {
  const trimmed = s.trim();
  const angle = /<([^>]+)>\s*$/.exec(trimmed);
  return (angle ? angle[1]! : trimmed).trim().toLowerCase();
}

interface ExternalGuestsCardProps {
  guests: string[];
  onChange: (guests: string[]) => void;
  /** Called after new guests are added, so the form can scroll the whole list into view. */
  onAdded?: () => void;
  /** Reports whether the field holds text that was typed but not added yet. */
  onPendingChange?: (pending: boolean) => void;
}

/** Guests invited by email: an inline field with an Add button, and the added guests below it. */
const ExternalGuestsCardBase = ({
  guests,
  onChange,
  onAdded,
  onPendingChange,
}: ExternalGuestsCardProps): ReactElement => {
  const { accentBg, accentText } = useBubbleAccent();
  const descriptionColor = useCSSVariable('--color-settings-description') as string;
  const [draft, setDraft] = useState('');
  const [invalid, setInvalid] = useState(false);
  const canAdd = draft.trim().length > 0;

  useEffect(() => {
    onPendingChange?.(canAdd);
    return () => onPendingChange?.(false);
  }, [canAdd, onPendingChange]);

  /** Adds every address in the field (comma separated, so a pasted list works); flags bad ones. */
  const commit = (): void => {
    const emails = draft.split(',').map(normalize).filter(Boolean);
    if (emails.length === 0) return;
    const bad = emails.filter(email => !EMAIL_RE.test(email));
    const good = emails.filter(email => EMAIL_RE.test(email) && !guests.includes(email));
    if (good.length > 0) {
      onChange([...guests, ...new Set(good)]);
      onAdded?.();
    }
    setDraft(bad.join(', '));
    setInvalid(bad.length > 0);
  };

  const count = guests.length;

  return (
    <SectionCard className='mt-3'>
      <CardHeader
        icon={Globe}
        title='External'
        subtitle={
          count > 0
            ? `${count} ${count === 1 ? 'guest' : 'guests'} · email invite`
            : 'Email invite · join via link'
        }
      />
      <View className='px-3 pb-3 pt-1'>
        <View className='h-11 flex-row items-center rounded-full bg-secondary pl-4 pr-1'>
          <TextInput
            value={draft}
            onChangeText={text => {
              setInvalid(false);
              setDraft(text);
            }}
            onSubmitEditing={commit}
            placeholder='name@company.com'
            placeholderTextColor={descriptionColor}
            accessibilityLabel='Guest email'
            keyboardType='email-address'
            autoCapitalize='none'
            autoCorrect={false}
            spellCheck={false}
            autoComplete='off'
            importantForAutofill='no'
            returnKeyType='done'
            blurOnSubmit={false}
            cursorColor={accentBg}
            selectionColor={accentBg}
            className='min-w-0 flex-1 px-0 py-0 text-base text-foreground'
          />
          <Pressable
            accessibilityRole='button'
            accessibilityLabel='Add guest'
            accessibilityState={{ disabled: !canAdd }}
            disabled={!canAdd}
            onPress={commit}
            className='h-9 justify-center rounded-full px-3.5 active:opacity-70'
          >
            <Text
              className='text-sm font-semibold text-muted'
              style={canAdd ? { color: accentText } : undefined}
            >
              Add
            </Text>
          </Pressable>
        </View>
        {invalid ? (
          <Text className='px-4 pt-1.5 text-xs text-status-danger' accessibilityLiveRegion='polite'>
            Invalid email address
          </Text>
        ) : null}
      </View>

      {count > 0 ? (
        <>
          <ListRowDivider inset={0} />
          {/* Newest first, so a just-added address sits right under the field, in view. */}
          {[...guests].reverse().map(email => (
            <View key={email} className='min-h-12 flex-row items-center gap-3 pl-3.5 pr-2'>
              <View className='size-9 items-center justify-center rounded-full bg-secondary'>
                <Mail size={16} color={descriptionColor} />
              </View>
              <Text className='min-w-0 flex-1 text-base text-foreground' numberOfLines={1}>
                {email}
              </Text>
              <Pressable
                accessibilityRole='button'
                accessibilityLabel={`Remove ${email}`}
                hitSlop={8}
                onPress={() => {
                  void haptics.selection();
                  onChange(guests.filter(e => e !== email));
                }}
                className='size-9 items-center justify-center'
              >
                <X size={18} color={descriptionColor} />
              </Pressable>
            </View>
          ))}
        </>
      ) : null}
    </SectionCard>
  );
};

// Props are stable between keystrokes in the title, so the card skips those re-renders.
export const ExternalGuestsCard = memo(ExternalGuestsCardBase);
