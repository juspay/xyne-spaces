import { memo } from 'react';
import { View } from 'react-native';
import {
  Archive,
  // EllipsisVertical,
  // Mail,
  Sparkles,
} from 'lucide-react-native';
import { useCSSVariable } from 'uniwind';

// import { Dropdown } from '@/src/components/ui/dropdown';
import { useHeaderHeight } from '@/src/hooks/useHeaderHeight';

import { HeaderBackButton, HeaderIconButton } from '@/src/components/ui/header-icon-button';

type TicketDetailHeaderProps = {
  onBack: () => void;
  /** Hide when the thread has no emails (dashboard parity). */
  canSummarize?: boolean;
  isSummarizeLoading?: boolean;
  onSummarize?: () => void;
  /** Hide when ticket is already archived. */
  canArchive?: boolean;
  onArchive?: () => void;
  onMarkUnread?: () => void;
  onMoreAction?: (action: 'reply-all' | 'forward' | 'copy-id') => void;
};

export const TicketDetailHeader = memo(function TicketDetailHeader({
  onBack,
  canSummarize = true,
  isSummarizeLoading = false,
  onSummarize,
  canArchive = true,
  onArchive,
  // onMarkUnread,
  // onMoreAction,
}: TicketDetailHeaderProps) {
  const { topSafeHeight, headerHeight } = useHeaderHeight();
  const foreground = useCSSVariable('--color-foreground') as string;
  // const menuBackground = useCSSVariable('--color-card') as string;
  // const borderColor = useCSSVariable('--color-border') as string;

  return (
    <View
      pointerEvents='box-none'
      style={{ paddingTop: topSafeHeight, zIndex: 40 }}
      className='absolute left-0 right-0 bg-neutral-100 dark:bg-tabs-screen'
    >
      <View style={{ height: headerHeight }} className='flex-row items-center px-2'>
        <HeaderBackButton
          liquidGlass
          accessibilityLabel='Go back'
          onPress={onBack}
          iconColor={foreground}
        />

        <View className='flex-1' />

        {canSummarize ? (
          <HeaderIconButton
            liquidGlass
            accessibilityLabel='Summarize with AI'
            onPress={() => onSummarize?.()}
            disabled={isSummarizeLoading}
          >
            <Sparkles size={20} color={foreground} />
          </HeaderIconButton>
        ) : null}
        {canArchive ? (
          <HeaderIconButton liquidGlass accessibilityLabel='Archive' onPress={() => onArchive?.()}>
            <Archive size={20} color={foreground} />
          </HeaderIconButton>
        ) : null}
        {/* <HeaderIconButton label='Mark as unread' onPress={onMarkUnread}>
          <Mail size={20} color={foreground} />
        </HeaderIconButton> */}

        {/* <Dropdown>
          <Dropdown.Trigger
            accessibilityLabel='More actions'
            className='size-10 items-center justify-center'
          >
            <EllipsisVertical size={20} color={foreground} />
          </Dropdown.Trigger>
          <Dropdown.Content
            side='bottom'
            align='end'
            sideOffset={4}
            edgePadding={8}
            minWidth={180}
            style={{
              backgroundColor: menuBackground,
              borderColor,
              borderWidth: 0.3,
            }}
          >
            <Dropdown.Item onSelect={() => onMoreAction?.('reply-all')} className='py-3'>
              <Text className='text-base text-foreground'>Reply all</Text>
            </Dropdown.Item>
            <Dropdown.Item onSelect={() => onMoreAction?.('forward')} className='py-3'>
              <Text className='text-base text-foreground'>Forward</Text>
            </Dropdown.Item>
            <Dropdown.Item onSelect={() => onMoreAction?.('copy-id')} className='py-3'>
              <Text className='text-base text-foreground'>Copy ticket ID</Text>
            </Dropdown.Item>
          </Dropdown.Content>
        </Dropdown> */}
      </View>
    </View>
  );
});
