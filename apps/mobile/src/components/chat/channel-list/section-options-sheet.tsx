import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react';
import { View, Text, Pressable } from 'react-native';
import { BottomSheetScrollView } from '@gorhom/bottom-sheet';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useCSSVariable } from 'uniwind';
import type { ChannelSection } from '@xyne/shared';
import { AppBottomSheet, type AppBottomSheetRef } from '@/src/components/ui/app-bottom-sheet';
import { Pencil, Plus, Trash2, ListChecks } from 'lucide-react-native';
import { cn } from '@/src/utils/cn';

/** Left inset of a row's label, so separators line up under the text. */
const ROW_LABEL_INSET = 52;

/** Everything the sheet shows about the section it was opened from. */
export type SectionOptionsTarget = {
  section: ChannelSection;
  channelCount: number;
  unreadCount: number;
};

type SectionOptionsSheetProps = {
  target: SectionOptionsTarget | null;
  isOpen: boolean;
  onClose: () => void;
  onRename: (section: ChannelSection) => void;
  onManageChannels: (section: ChannelSection) => void;
  /** Starts a brand new section. Nothing to do with the one shown above. */
  onCreateSection: () => void;
  onDelete: (section: ChannelSection) => void;
};

export function SectionOptionsSheet({
  target,
  isOpen,
  onClose,
  onRename,
  onManageChannels,
  onCreateSection,
  onDelete,
}: SectionOptionsSheetProps): ReactElement | null {
  const [shouldRender, setShouldRender] = useState(isOpen);

  useEffect(() => {
    if (isOpen) {
      setShouldRender(true);
    }
  }, [isOpen]);

  const handleOpenChange = useCallback(
    (open: boolean) => {
      if (!open) {
        onClose();
      }
    },
    [onClose],
  );

  const handleDismiss = useCallback(() => {
    setShouldRender(false);
  }, []);

  const section = target?.section ?? null;

  const handleRename = useCallback(() => {
    if (section) onRename(section);
  }, [section, onRename]);

  const handleManageChannels = useCallback(() => {
    if (section) onManageChannels(section);
  }, [section, onManageChannels]);

  const handleDelete = useCallback(() => {
    if (section) onDelete(section);
  }, [section, onDelete]);

  if (!shouldRender || !target) {
    return null;
  }

  return (
    <SectionOptionsSheetContent
      target={target}
      isOpen={isOpen}
      onOpenChange={handleOpenChange}
      onDismiss={handleDismiss}
      onRename={handleRename}
      onManageChannels={handleManageChannels}
      onCreateSection={onCreateSection}
      onDelete={handleDelete}
    />
  );
}

function SectionOptionsSheetContent({
  target,
  isOpen,
  onOpenChange,
  onDismiss,
  onRename,
  onManageChannels,
  onCreateSection,
  onDelete,
}: {
  target: SectionOptionsTarget;
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  onDismiss: () => void;
  onRename: () => void;
  onManageChannels: () => void;
  onCreateSection: () => void;
  onDelete: () => void;
}): ReactElement {
  const sheetRef = useRef<AppBottomSheetRef>(null);
  const insets = useSafeAreaInsets();
  const foregroundColor = useCSSVariable('--color-foreground') as string;
  const dangerColor = useCSSVariable('--color-status-danger') as string;
  const { section, channelCount, unreadCount } = target;

  const dismiss = useCallback(() => {
    sheetRef.current?.dismiss();
  }, []);

  const pendingActionRef = useRef<(() => void) | null>(null);

  const dismissThen = useCallback(
    (action: () => void) => {
      pendingActionRef.current = action;
      dismiss();
    },
    [dismiss],
  );

  const handleSheetDismiss = useCallback(() => {
    const action = pendingActionRef.current;
    pendingActionRef.current = null;
    onDismiss();
    // Hop off gorhom's onChange stack before mounting another overlay.
    // Opening a FullWindowOverlay during native dismiss can crash on iOS.
    if (action) {
      setTimeout(action, 0);
    }
  }, [onDismiss]);

  const handleRename = useCallback(() => {
    dismissThen(onRename);
  }, [dismissThen, onRename]);

  const handleManageChannels = useCallback(() => {
    dismissThen(onManageChannels);
  }, [dismissThen, onManageChannels]);

  const handleCreateSection = useCallback(() => {
    dismissThen(onCreateSection);
  }, [dismissThen, onCreateSection]);

  const handleDelete = useCallback(() => {
    dismissThen(onDelete);
  }, [dismissThen, onDelete]);

  const channelSummary = `${channelCount} ${channelCount === 1 ? 'channel' : 'channels'}`;
  const subtitle = unreadCount > 0 ? `${channelSummary} · ${unreadCount} unread` : channelSummary;

  return (
    <AppBottomSheet
      ref={sheetRef}
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      onDismiss={handleSheetDismiss}
      backdropOpacity={0.4}
    >
      <BottomSheetScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingBottom: insets.bottom + 16 }}
      >
        <View className='px-5 pb-4 pt-2'>
          <View className='flex-row items-center'>
            {section.emoji ? <Text className='mr-1.5 text-lg'>{section.emoji}</Text> : null}
            <Text className='flex-1 text-lg font-semibold text-foreground' numberOfLines={1}>
              {section.name}
            </Text>
          </View>
          <Text className='mt-0.5 text-xs text-bottomsheet-text-muted'>{subtitle}</Text>
        </View>

        <OptionGroup>
          <OptionRow
            icon={<Pencil size={19} color={foregroundColor} />}
            label='Rename section'
            onPress={handleRename}
          />
          <OptionRow
            icon={<ListChecks size={19} color={foregroundColor} />}
            label='Manage channels'
            trailing={channelCount > 0 ? String(channelCount) : undefined}
            onPress={handleManageChannels}
          />
          {/* Slack's own section menu carries this too: the moment you are
              already thinking about how the sidebar is grouped is a fair
              moment to want another group. */}
          <OptionRow
            icon={<Plus size={19} color={foregroundColor} />}
            label='Create section'
            onPress={handleCreateSection}
            isLast
          />
        </OptionGroup>

        {/* Delete keeps its own container: detached from the edits above, it is
            harder to hit by muscle memory on the way to Manage channels. */}
        <OptionGroup className='mt-3'>
          <OptionRow
            icon={<Trash2 size={19} color={dangerColor} />}
            label='Delete section'
            destructive
            onPress={handleDelete}
            isLast
          />
        </OptionGroup>
      </BottomSheetScrollView>
    </AppBottomSheet>
  );
}

function OptionGroup({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}): ReactElement {
  return (
    <View className={cn('mx-4 overflow-hidden rounded-2xl bg-bottomsheet-container-bg', className)}>
      {children}
    </View>
  );
}

type OptionRowProps = {
  icon: ReactElement;
  label: string;
  onPress: () => void;
  trailing?: string | undefined;
  destructive?: boolean;
  isLast?: boolean;
};

function OptionRow({
  icon,
  label,
  onPress,
  trailing,
  destructive,
  isLast,
}: OptionRowProps): ReactElement {
  return (
    <>
      <Pressable
        onPress={onPress}
        accessibilityRole='button'
        accessibilityLabel={label}
        className='flex-row items-center px-4 py-3.5 active:opacity-60'
      >
        <View className='w-7'>{icon}</View>
        <Text
          className={cn(
            'flex-1 text-[15px] font-medium',
            destructive ? 'text-status-danger' : 'text-foreground',
          )}
        >
          {label}
        </Text>
        {trailing ? (
          <Text className='text-[13px] text-bottomsheet-text-muted'>{trailing}</Text>
        ) : null}
      </Pressable>
      {!isLast && <View className='h-px bg-border' style={{ marginLeft: ROW_LABEL_INSET }} />}
    </>
  );
}
