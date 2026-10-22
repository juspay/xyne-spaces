import { useEffect, useState, type ReactElement } from 'react';
import { Pressable, Text, View } from 'react-native';
import { BottomSheetTextInput, BottomSheetView } from '@gorhom/bottom-sheet';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppBottomSheet } from '@/src/components/ui/app-bottom-sheet';
import { Switch } from '@/src/components/ui/switch';

import { DAILY_BRIEF_INSTRUCTIONS_LIMIT, type DailyBriefConfig } from '../api/dailyBriefApi';

type BriefSettingsSheetProps = {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  config: DailyBriefConfig | undefined;
  saving: boolean;
  busy: boolean;
  /** Persist the patch. `instructionsEnabled` is ALWAYS sent — the API
   *  silently re-enables instructions otherwise. */
  onSave: (
    patch: { enabled: boolean; instructions: string; instructionsEnabled: boolean },
    regenerateAfter: boolean,
  ) => void;
  foregroundColor: string;
  mutedColor: string;
  borderColor: string;
};

/**
 * Brief settings — the web's BriefSettingsDialog plus the master enable
 * toggle (which the web keeps in Preferences): scheduled-brief on/off,
 * "use my instructions" toggle, and the 8,000-char instructions editor with
 * Save / Save & regenerate.
 */
export function BriefSettingsSheet({
  isOpen,
  onOpenChange,
  config,
  saving,
  busy,
  onSave,
  foregroundColor,
  mutedColor,
  borderColor,
}: BriefSettingsSheetProps): ReactElement {
  const [enabled, setEnabled] = useState(false);
  const [instructionsEnabled, setInstructionsEnabled] = useState(true);
  const [instructions, setInstructions] = useState('');
  const insets = useSafeAreaInsets();

  // Seed the form each time the sheet opens with the latest saved config.
  useEffect(() => {
    if (isOpen && config) {
      setEnabled(config.enabled);
      setInstructionsEnabled(config.instructionsEnabled);
      setInstructions(config.instructions);
    }
  }, [isOpen, config]);

  const overLimit = instructions.length > DAILY_BRIEF_INSTRUCTIONS_LIMIT;
  const counterColor = overLimit ? '#dc2626' : mutedColor;
  const saveDisabled = saving || overLimit;

  const submit = (regenerateAfter: boolean): void => {
    onSave({ enabled, instructions, instructionsEnabled }, regenerateAfter);
    onOpenChange(false);
  };

  return (
    <AppBottomSheet isOpen={isOpen} onOpenChange={onOpenChange} mode='dynamic'>
      {/* mode='dynamic' needs BottomSheetView for its content measurement. */}
      <BottomSheetView style={{ paddingBottom: insets.bottom }}>
        <View className='gap-4 px-5 pb-8 pt-2'>
          <Text className='text-[17px] font-semibold text-foreground'>Brief settings</Text>

          <View className='flex-row items-center justify-between'>
            <View className='min-w-0 flex-1 pr-3'>
              <Text className='text-[15px] text-foreground'>Morning brief</Text>
              <Text className='mt-0.5 text-[13px]' style={{ color: mutedColor }}>
                Get a brief generated for you each morning
              </Text>
            </View>
            <Switch isSelected={enabled} onSelectedChange={setEnabled} />
          </View>

          <View className='flex-row items-center justify-between'>
            <View className='min-w-0 flex-1 pr-3'>
              <Text className='text-[15px] text-foreground'>Use my instructions</Text>
              <Text className='mt-0.5 text-[13px]' style={{ color: mutedColor }}>
                Apply the notes below when generating your brief
              </Text>
            </View>
            <Switch isSelected={instructionsEnabled} onSelectedChange={setInstructionsEnabled} />
          </View>

          <View>
            <BottomSheetTextInput
              value={instructions}
              onChangeText={setInstructions}
              multiline
              placeholder='e.g. Lead with anything from #incidents, keep it short…'
              placeholderTextColor={mutedColor}
              className='min-h-[120px] rounded-xl border p-3 text-[15px]'
              style={{
                borderColor: overLimit ? '#dc2626' : borderColor,
                color: foregroundColor,
                textAlignVertical: 'top',
              }}
              editable={!saving}
            />
            <Text className='mt-1 self-end text-[12px]' style={{ color: counterColor }}>
              {instructions.length.toLocaleString()} /{' '}
              {DAILY_BRIEF_INSTRUCTIONS_LIMIT.toLocaleString()}
            </Text>
          </View>

          <View className='flex-row items-center justify-end gap-2'>
            <Pressable
              onPress={() => submit(true)}
              disabled={saveDisabled || busy}
              accessibilityRole='button'
              className='h-9 justify-center rounded-lg border px-3'
              style={({ pressed }) => ({
                borderColor,
                opacity: saveDisabled || busy ? 0.5 : pressed ? 0.7 : 1,
              })}
            >
              <Text className='text-[14px] font-medium text-foreground'>Save & regenerate</Text>
            </Pressable>
            <Pressable
              onPress={() => submit(false)}
              disabled={saveDisabled}
              accessibilityRole='button'
              className='h-9 justify-center rounded-lg bg-foreground px-4'
              style={({ pressed }) => ({ opacity: saveDisabled ? 0.5 : pressed ? 0.9 : 1 })}
            >
              <Text className='text-[14px] font-semibold text-background'>
                {saving ? 'Saving…' : 'Save'}
              </Text>
            </Pressable>
          </View>
        </View>
      </BottomSheetView>
    </AppBottomSheet>
  );
}
