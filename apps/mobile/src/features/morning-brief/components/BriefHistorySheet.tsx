import { useEffect, useState, type ReactElement } from 'react';
import { Pressable, Text, View } from 'react-native';
import { BottomSheetView } from '@gorhom/bottom-sheet';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CalendarDays, ChevronLeft, ChevronRight, FileText } from 'lucide-react-native';

import { AppBottomSheet } from '@/src/components/ui/app-bottom-sheet';
import { haptics } from '@/src/utils/haptics';

import type { BriefSwitchSource, DailyBriefHistoryItem } from '../api/dailyBriefApi';
import { briefMenuLabel } from '../utils/selectors';
import { BriefCalendar } from './BriefCalendar';

type BriefHistorySheetProps = {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  history: DailyBriefHistoryItem[];
  availableDates: string[];
  selectedDate: string | null;
  onSelect: (date: string, source: BriefSwitchSource) => void;
  foregroundColor: string;
  mutedColor: string;
  borderColor: string;
  /** Selected-day tint for the native calendar. */
  accentColor: string;
};

/**
 * History bottom sheet — the last 7 briefs, with "Find a Brief" swapping to a
 * month calendar of every day that has one (the web's BriefHistoryMenu).
 */
export function BriefHistorySheet({
  isOpen,
  onOpenChange,
  history,
  availableDates,
  selectedDate,
  onSelect,
  foregroundColor,
  mutedColor,
  borderColor,
  accentColor,
}: BriefHistorySheetProps): ReactElement {
  const [view, setView] = useState<'list' | 'calendar'>('list');
  const insets = useSafeAreaInsets();

  // Re-open always starts on the list, like the web menu.
  useEffect(() => {
    if (isOpen) setView('list');
  }, [isOpen]);

  const handleSelect = (date: string, source: BriefSwitchSource): void => {
    onOpenChange(false);
    onSelect(date, source);
  };

  return (
    <AppBottomSheet isOpen={isOpen} onOpenChange={onOpenChange} mode='dynamic'>
      {/* mode='dynamic' sizes off BottomSheetView's measurement — a plain View
          never reports a height, the sheet never opens, and the portal's
          touch-interception layer is left permanently active. */}
      <BottomSheetView style={{ paddingBottom: insets.bottom }}>
        <View className='px-3 pb-6 pt-1'>
          {view === 'list' ? (
            <>
              {history.length === 0 && (
                <Text className='px-2.5 py-2 text-[13px]' style={{ color: mutedColor }}>
                  No past briefs.
                </Text>
              )}
              {history.map(item => {
                const isActive = item.date === selectedDate;
                return (
                  <Pressable
                    key={item.date}
                    onPress={() => {
                      void haptics.buttonTap();
                      handleSelect(item.date, 'history_menu');
                    }}
                    accessibilityRole='button'
                    accessibilityLabel={briefMenuLabel(item.date)}
                    className='w-full flex-row items-center gap-2.5 rounded-lg px-2.5 py-2.5'
                    style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
                  >
                    <FileText
                      size={16}
                      color={isActive ? foregroundColor : mutedColor}
                      strokeWidth={1.8}
                    />
                    <Text
                      className={`text-[14px] ${isActive ? 'font-medium' : 'font-normal'}`}
                      style={{
                        color: isActive ? foregroundColor : mutedColor,
                        letterSpacing: -0.1,
                      }}
                    >
                      {briefMenuLabel(item.date)}
                    </Text>
                  </Pressable>
                );
              })}
              <View
                className='mt-1 pt-1'
                style={{ borderTopWidth: 1, borderTopColor: borderColor }}
              >
                <Pressable
                  onPress={() => {
                    void haptics.buttonTap();
                    setView('calendar');
                  }}
                  accessibilityRole='button'
                  accessibilityLabel='Find a Brief'
                  className='w-full flex-row items-center gap-2.5 rounded-lg px-2.5 py-2.5'
                  style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
                >
                  <CalendarDays size={16} color={mutedColor} strokeWidth={1.8} />
                  <Text
                    className='flex-1 text-[14px]'
                    style={{ color: foregroundColor, letterSpacing: -0.1 }}
                  >
                    Find a Brief
                  </Text>
                  <ChevronRight size={14} color={mutedColor} strokeWidth={1.8} />
                </Pressable>
              </View>
            </>
          ) : (
            <>
              <Pressable
                onPress={() => {
                  void haptics.buttonTap();
                  setView('list');
                }}
                accessibilityRole='button'
                accessibilityLabel='Back to list view'
                className='flex-row items-center gap-1 px-2.5 py-2'
                style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
              >
                <ChevronLeft size={14} color={mutedColor} strokeWidth={1.8} />
                <Text className='text-[12px] font-medium' style={{ color: mutedColor }}>
                  List View
                </Text>
              </Pressable>
              <BriefCalendar
                availableDates={availableDates}
                selectedDate={selectedDate}
                onSelect={date => handleSelect(date, 'date_picker')}
                onDismiss={() => setView('list')}
                mutedColor={mutedColor}
                accentColor={accentColor}
              />
            </>
          )}
        </View>
      </BottomSheetView>
    </AppBottomSheet>
  );
}
