import { useChannelList } from '@/src/hooks/useChannelList';
import { useHeaderHeight } from '@/src/hooks/useHeaderHeight';
import type { ChannelListItemData, ChannelListRow } from '@/src/types/channel-list';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import {
  Alert,
  Keyboard,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { AnimatedLegendList } from '@legendapp/list/reanimated';
import { LegendListRef } from '@legendapp/list/react-native';
import type { SharedValue } from 'react-native-reanimated';
import { useRegisterTabScrollToTop } from '@/src/hooks/useRegisterTabScrollToTop';
import { useTabPageIsFocused } from '@/src/hooks/useTabPageFocus';
import { useRouter } from 'expo-router';
import { ChannelListItem } from './channel-list-item';
import { ChannelGroupHeader } from './channel-group-header';
import { SectionOptionsSheet, type SectionOptionsTarget } from './section-options-sheet';
import { RenameSectionSheet } from './rename-section-sheet';
import { ManageSectionChannelsSheet } from './manage-section-channels-sheet';
import { CreateSectionSheet } from './create-section-sheet';
import { CHANNEL_FILTER_TABS, type ChannelFilterTab } from './channel-list.utils';
import ChatFilterTabs, { type ChatFilterTabOption } from '@/src/components/chat/chat-filter-tabs';
import { ListEmptyState, type EmptyIllustrationName } from '@/src/components/ui/empty-state';
import { openBaseChatRoute } from '@/src/utils/openChatRoute';
import { haptics } from '@/src/utils/haptics';
import { showMessageToast } from '@/src/utils/toast';
import { useAuth } from '@/src/contexts/AuthContext';
import { beginCriticalWindow, endCriticalWindow } from '@/src/utils/interactionCriticalWindow';
import { useChannelSections } from '@/src/hooks/useChannelSections';
import { useChannelGroupCollapse } from '@/src/hooks/useChannelGroupCollapse';
import { CHANNEL_ROW_GUTTER } from './channel-list-layout';
import { useCloseOnScreenBlur } from '@/src/hooks/useCloseOnScreenBlur';
import type { ChannelSection } from '@xyne/shared';

type ChannelsListProps = {
  headerTitleScrollY?: SharedValue<number> | undefined;
};

function ChannelListChannelRow({ item }: { item: ChannelListItemData }): ReactElement {
  const router = useRouter();
  return (
    <ChannelListItem
      data={item}
      onPress={() => {
        haptics.buttonTap();
        openBaseChatRoute(router, item.id, {
          surface: 'channels',
          unreadCount: item.messageUnreadCount ?? 0,
          unreadLastViewedAt: item.lastViewedAt,
          unreadLastViewedConversationId: item.lastViewedConversationId,
        });
      }}
    >
      {/* Every row sits on the same gutter, sectioned or not — the rules around
          a group header are what mark ownership, so no row needs an indent. */}
      <View className='flex-row items-center py-2 pr-3' style={{ paddingLeft: CHANNEL_ROW_GUTTER }}>
        <ChannelListItem.Icon />
        <View className='flex-1 min-w-0 ml-3'>
          <ChannelListItem.Name />
        </View>
        <ChannelListItem.UnreadBadge />
      </View>
    </ChannelListItem>
  );
}

const CHANNEL_FILTER_TAB_LABELS: Record<ChannelFilterTab, string> = {
  all: 'All',
  mentions: 'Mentions',
  starred: 'Starred',
};

type ChannelEmptyContent = {
  illustration: EmptyIllustrationName;
  title: string;
  subtitle: string;
};

function getFilterEmptyMessage(activeTab: ChannelFilterTab): ChannelEmptyContent {
  switch (activeTab) {
    case 'mentions':
      return {
        illustration: 'channelMentions',
        title: 'No mentions',
        subtitle: 'Channels where someone mentions you will appear here.',
      };
    case 'starred':
      return {
        illustration: 'channelStarred',
        title: 'No starred channels',
        subtitle: 'Star a channel to keep it within reach.',
      };
    case 'all':
    default:
      return {
        illustration: 'channels',
        title: 'No channels yet',
        subtitle: 'Channels you join will appear here.',
      };
  }
}

export const ChannelsList = ({ headerTitleScrollY }: ChannelsListProps = {}): ReactElement => {
  const { topSafeHeight, headerHeight, searchBarHeight, searchBarGap } = useHeaderHeight();
  const { user } = useAuth();
  const isFocused = useTabPageIsFocused();
  const [activeTab, setActiveTab] = useState<ChannelFilterTab>('all');
  const listRef = useRef<LegendListRef>(null);
  const { toggleCollapse, deleteSection } = useChannelSections();
  const { toggleGroup } = useChannelGroupCollapse();

  const [optionsTarget, setOptionsTarget] = useState<SectionOptionsTarget | null>(null);
  const [isOptionsOpen, setIsOptionsOpen] = useState(false);
  const [sectionToRename, setSectionToRename] = useState<ChannelSection | null>(null);
  const [isRenameOpen, setIsRenameOpen] = useState(false);
  const [sectionToManage, setSectionToManage] = useState<ChannelSection | null>(null);
  const [isManageOpen, setIsManageOpen] = useState(false);
  /**
   * The FAB owns its own create sheet, and its menu morphs into the FAB before
   * opening one. Reaching that state from here would mean unpicking that
   * choreography, so the list keeps a second instance — both render nothing
   * until opened, and only one is ever open.
   */
  const [isCreateOpen, setIsCreateOpen] = useState(false);

  useCloseOnScreenBlur(() => {
    setIsOptionsOpen(false);
    setIsRenameOpen(false);
    setIsManageOpen(false);
    setIsCreateOpen(false);
  });

  const scrollListToTop = useCallback((animated = false) => {
    Keyboard.dismiss();
    listRef.current?.scrollToOffset?.({ offset: 0, animated });
  }, []);

  const scrollToTop = useCallback(() => scrollListToTop(true), [scrollListToTop]);
  useRegisterTabScrollToTop('channels', scrollToTop);

  const { rows: visibleRows, isEmpty } = useChannelList('', activeTab);
  const listPaddingTop =
    topSafeHeight + headerHeight + searchBarGap + searchBarHeight + searchBarGap;
  const listPaddingBottom = 100;
  const workspaceListKey = user?.workspaceId ?? user?.user_id ?? 'anonymous';

  useEffect(() => {
    return (): void => endCriticalWindow('scroll:channels');
  }, []);

  useEffect(() => {
    if (isFocused) return;
    endCriticalWindow('scroll:channels');
  }, [isFocused]);

  const keyExtractor = useCallback((item: ChannelListRow) => item.id, []);

  const handleTabChange = useCallback((tab: ChannelFilterTab) => {
    Keyboard.dismiss();
    setActiveTab(tab);
  }, []);

  const handleScrollBeginDrag = useCallback(() => {
    beginCriticalWindow('scroll:channels');
    Keyboard.dismiss();
  }, []);

  const handleMomentumScrollBegin = useCallback(() => {
    beginCriticalWindow('scroll:channels');
  }, []);

  const handleMomentumScrollEnd = useCallback(() => {
    endCriticalWindow('scroll:channels');
  }, []);

  const handleScrollEndDrag = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (event.nativeEvent.velocity?.y) return;
    endCriticalWindow('scroll:channels');
  }, []);

  const filterTabs = useMemo<ChatFilterTabOption<ChannelFilterTab>[]>(
    () => CHANNEL_FILTER_TABS.map(tab => ({ value: tab, label: CHANNEL_FILTER_TAB_LABELS[tab] })),
    [],
  );

  const listHeader = useMemo(
    () => (
      <View className='px-3 pb-2.5'>
        <ChatFilterTabs tabs={filterTabs} activeTab={activeTab} onTabChange={handleTabChange} />
      </View>
    ),
    [activeTab, filterTabs, handleTabChange],
  );

  const ListEmpty = useMemo(() => {
    const content = getFilterEmptyMessage(isEmpty ? 'all' : activeTab);
    return <ListEmptyState {...content} />;
  }, [activeTab, isEmpty]);

  const handleToggleSection = useCallback(
    (section: ChannelSection) => {
      toggleCollapse(section.id, section.isCollapsed);
    },
    [toggleCollapse],
  );

  const handleMorePress = useCallback((target: SectionOptionsTarget) => {
    setOptionsTarget(target);
    setIsOptionsOpen(true);
  }, []);

  const handleRenameFromOptions = useCallback((section: ChannelSection) => {
    setSectionToRename(section);
    setIsRenameOpen(true);
  }, []);

  const handleManageFromOptions = useCallback((section: ChannelSection) => {
    setSectionToManage(section);
    setIsManageOpen(true);
  }, []);

  const handleCreateFromOptions = useCallback(() => {
    setIsCreateOpen(true);
  }, []);

  /**
   * Deleting is one tap away in the options sheet and cannot be undone, so it
   * asks first. The channels themselves survive — they fall back to the
   * unsectioned group — which is what the message spells out.
   */
  const handleDeleteFromOptions = useCallback(
    (section: ChannelSection) => {
      Alert.alert(
        `Delete "${section.name}"?`,
        'The channels in this section will move back to your main channel list.',
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Delete',
            style: 'destructive',
            onPress: (): void => {
              deleteSection(section.id);
              void haptics.success();
              // No tone: the haptic above already reports the outcome.
              showMessageToast(`${section.name} deleted successfully`);
            },
          },
        ],
      );
    },
    [deleteSection],
  );

  const renderItem = useCallback(
    ({ item }: { item: ChannelListRow }): ReactElement => {
      if (item.kind === 'section-header') {
        if (item.group === 'section') {
          const { section } = item;
          return (
            <ChannelGroupHeader
              title={section.name}
              glyph='folder'
              unreadCount={item.unreadCount}
              channelCount={item.channelCount}
              isCollapsed={item.isCollapsed}
              isFirstGroup={item.isFirstGroup}
              onToggle={() => handleToggleSection(section)}
              onMorePress={() =>
                handleMorePress({
                  section,
                  channelCount: item.channelCount,
                  unreadCount: item.unreadCount,
                })
              }
            />
          );
        }

        // Starred and Channels are built in — nothing to rename or delete, so
        // they carry no overflow menu.
        const group = item.group;
        return (
          <ChannelGroupHeader
            title={item.title}
            glyph={group === 'starred' ? 'star' : 'hash'}
            unreadCount={item.unreadCount}
            channelCount={item.channelCount}
            isCollapsed={item.isCollapsed}
            isFirstGroup={item.isFirstGroup}
            onToggle={() => toggleGroup(group)}
          />
        );
      }
      return <ChannelListChannelRow item={item.data} />;
    },
    [handleToggleSection, handleMorePress, toggleGroup],
  );

  const getItemType = useCallback(
    (item: ChannelListRow) => (item.kind === 'section-header' ? 'sectionHeader' : 'channel'),
    [],
  );

  return (
    <View className='flex-1 bg-tabs-screen'>
      <AnimatedLegendList
        ref={listRef}
        key={workspaceListKey}
        data={visibleRows}
        drawDistance={300}
        estimatedItemSize={72}
        extraData={activeTab}
        keyExtractor={keyExtractor}
        ListEmptyComponent={ListEmpty}
        ListHeaderComponent={listHeader}
        keyboardDismissMode='on-drag'
        keyboardShouldPersistTaps='handled'
        recycleItems
        renderItem={renderItem}
        getItemType={getItemType}
        showsVerticalScrollIndicator={false}
        {...(headerTitleScrollY ? { sharedValues: { scrollOffset: headerTitleScrollY } } : {})}
        style={{ flex: 1 }}
        contentContainerStyle={{
          paddingTop: listPaddingTop,
          paddingBottom: listPaddingBottom,
          flexGrow: visibleRows.length === 0 ? 1 : undefined,
        }}
        contentContainerClassName='bg-tabs-screen'
        onMomentumScrollBegin={handleMomentumScrollBegin}
        onMomentumScrollEnd={handleMomentumScrollEnd}
        onScrollBeginDrag={handleScrollBeginDrag}
        onScrollEndDrag={handleScrollEndDrag}
        scrollEventThrottle={16}
      />

      <SectionOptionsSheet
        target={optionsTarget}
        isOpen={isOptionsOpen}
        onClose={() => setIsOptionsOpen(false)}
        onRename={handleRenameFromOptions}
        onManageChannels={handleManageFromOptions}
        onCreateSection={handleCreateFromOptions}
        onDelete={handleDeleteFromOptions}
      />
      <RenameSectionSheet
        section={sectionToRename}
        isOpen={isRenameOpen}
        onClose={() => setIsRenameOpen(false)}
      />
      <ManageSectionChannelsSheet
        section={sectionToManage}
        isOpen={isManageOpen}
        onClose={() => setIsManageOpen(false)}
      />
      <CreateSectionSheet isOpen={isCreateOpen} onClose={() => setIsCreateOpen(false)} />
    </View>
  );
};
