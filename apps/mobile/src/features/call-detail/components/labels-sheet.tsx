import { useEffect, useState, type ReactElement } from 'react';
import { Pressable, Text, View } from 'react-native';
import { BottomSheetScrollView, BottomSheetTextInput } from '@gorhom/bottom-sheet';
import { Check, Plus, X } from 'lucide-react-native';
import { useCSSVariable } from 'uniwind';

import { AppBottomSheet } from '@/src/components/ui/app-bottom-sheet';
import { haptics } from '@/src/utils/haptics';
import { showMessageToast } from '@/src/utils/toast';

import type { CallLabel } from '../hooks/use-call-labels';
import { getLabelColor, normalizeLabelInput } from '../utils/call-detail-format';

const MAX_LABELS = 10;

export function LabelChip({
  name,
  onRemove,
}: {
  name: string;
  onRemove?: () => void;
}): ReactElement {
  const color = getLabelColor(name);
  return (
    <View
      className='flex-row items-center gap-1.5 h-7 rounded-lg pl-2'
      style={{ backgroundColor: `${color}1F`, paddingRight: onRemove ? 4 : 8 }}
    >
      <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: color }} />
      <Text className='text-[12.5px] font-medium' style={{ color }} numberOfLines={1}>
        {name}
      </Text>
      {onRemove ? (
        <Pressable
          onPress={onRemove}
          hitSlop={8}
          accessibilityRole='button'
          accessibilityLabel={`Remove label ${name}`}
          className='p-0.5 active:opacity-60'
        >
          <X size={13} color={color} />
        </Pressable>
      ) : null}
    </View>
  );
}

/** An AI-suggested label, as on the dashboard: dashed outline, tick to keep it, cross to dismiss. */
export function SuggestedLabelChip({
  name,
  onConfirm,
  onDismiss,
}: {
  name: string;
  onConfirm: () => void;
  onDismiss: () => void;
}): ReactElement {
  const color = getLabelColor(name);
  const foreground = useCSSVariable('--color-foreground') as string;
  return (
    <View
      className='h-7 flex-row items-center gap-1.5 rounded-lg border border-dashed border-border pl-2 pr-1'
      accessibilityLabel={`Suggested label ${name}`}
    >
      <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: color }} />
      <Text className='text-[12.5px] font-medium text-foreground' numberOfLines={1}>
        {name}
      </Text>
      <Pressable
        onPress={(): void => {
          void haptics.selection();
          onConfirm();
        }}
        hitSlop={6}
        accessibilityRole='button'
        accessibilityLabel={`Confirm suggested label ${name}`}
        className='p-0.5 active:opacity-60'
      >
        <Check size={13} color={foreground} />
      </Pressable>
      <Pressable
        onPress={(): void => {
          void haptics.selection();
          onDismiss();
        }}
        hitSlop={6}
        accessibilityRole='button'
        accessibilityLabel={`Dismiss suggested label ${name}`}
        className='p-0.5 active:opacity-60'
      >
        <X size={13} color={foreground} />
      </Pressable>
    </View>
  );
}

export function LabelsSheet({
  isOpen,
  onClose,
  labels,
  suggestions,
  canEdit,
  onChange,
  onConfirmSuggestion,
  onDismissSuggestion,
}: {
  isOpen: boolean;
  onClose: () => void;
  labels: CallLabel[];
  suggestions: CallLabel[];
  canEdit: boolean;
  onChange: (nextIds: string[]) => void;
  onConfirmSuggestion: (id: string) => void;
  onDismissSuggestion: (id: string) => void;
}): ReactElement {
  const muted = useCSSVariable('--color-secondary-foreground') as string;
  const foreground = useCSSVariable('--color-foreground') as string;
  const [draft, setDraft] = useState('');

  useEffect(() => {
    if (!isOpen) setDraft('');
  }, [isOpen]);

  const ids = labels.map(label => label.id);
  const addLabel = (): void => {
    const next = normalizeLabelInput(draft);
    if (!next) return;
    if (labels.some(label => label.name.toLowerCase() === next.toLowerCase())) {
      setDraft('');
      return;
    }
    if (labels.length >= MAX_LABELS) {
      showMessageToast(`A call can have up to ${MAX_LABELS} labels`, 'warning');
      return;
    }
    void haptics.selection();
    onChange([...ids, next]);
    setDraft('');
  };

  return (
    <AppBottomSheet
      isOpen={isOpen}
      onOpenChange={open => !open && onClose()}
      mode='dynamic'
      keyboardBehavior='interactive'
    >
      <BottomSheetScrollView
        keyboardShouldPersistTaps='handled'
        contentContainerStyle={{ paddingBottom: 32, paddingHorizontal: 20, gap: 16 }}
      >
        <View className='pt-1'>
          <Text className='text-lg font-semibold text-foreground'>Labels</Text>
          <Text className='text-[13px] text-secondary-foreground mt-0.5'>
            {canEdit ? 'Tag this call so it is easy to find later.' : 'Labels on this call.'}
          </Text>
        </View>

        {canEdit ? (
          <View className='flex-row items-center gap-2'>
            <BottomSheetTextInput
              value={draft}
              onChangeText={setDraft}
              placeholder='Add a label'
              placeholderTextColor={muted}
              returnKeyType='done'
              onSubmitEditing={addLabel}
              maxLength={40}
              autoCapitalize='none'
              style={{
                flex: 1,
                height: 42,
                borderRadius: 12,
                paddingHorizontal: 14,
                fontSize: 15,
                color: foreground,
              }}
              className='bg-secondary'
            />
            <Pressable
              onPress={addLabel}
              disabled={!normalizeLabelInput(draft)}
              accessibilityRole='button'
              accessibilityLabel='Add label'
              className='h-[42px] w-[42px] items-center justify-center rounded-xl bg-secondary active:opacity-70'
              style={{ opacity: normalizeLabelInput(draft) ? 1 : 0.4 }}
            >
              <Plus size={18} color={foreground} />
            </Pressable>
          </View>
        ) : null}

        {labels.length > 0 ? (
          <View className='flex-row flex-wrap gap-2'>
            {labels.map(label => (
              <LabelChip
                key={label.id}
                name={label.name}
                {...(canEdit
                  ? {
                      onRemove: (): void => {
                        void haptics.selection();
                        onChange(ids.filter(id => id !== label.id));
                      },
                    }
                  : {})}
              />
            ))}
          </View>
        ) : (
          <Text className='text-sm text-secondary-foreground'>No labels yet.</Text>
        )}

        {canEdit && suggestions.length > 0 ? (
          <View className='gap-2'>
            <Text className='text-[13px] font-medium text-secondary-foreground'>Suggested</Text>
            <View className='flex-row flex-wrap gap-2'>
              {suggestions.map(label => (
                <SuggestedLabelChip
                  key={label.id}
                  name={label.name}
                  onConfirm={(): void => onConfirmSuggestion(label.id)}
                  onDismiss={(): void => onDismissSuggestion(label.id)}
                />
              ))}
            </View>
          </View>
        ) : null}
      </BottomSheetScrollView>
    </AppBottomSheet>
  );
}
