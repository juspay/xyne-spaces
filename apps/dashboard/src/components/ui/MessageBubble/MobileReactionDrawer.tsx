import { useMemo, useState, useEffect, useRef } from 'react';
import { Drawer } from 'vaul';
import { parseReactionsMd, ReactionsData } from '@xyne/shared';
import { Tabs } from '@base-ui/react/tabs';
import { useAuth } from '../../../hooks/useAuth';
import { useUsers } from '../../../hooks/useUsers';
import Avatar from '../Avatar/Avatar';
import { renderEmoji } from '../../../utils/customEmojiUtils';
import { isStatusExpired } from '../../../utils/statusUtils';
import { AnimatePresence, motion, Variants } from 'framer-motion';
import { useLocation, useNavigate } from 'react-router-dom';
import { getUserDisplayName } from '../../../utils/userDisplayName';
import { type User } from '../../../machines/stateMachine';

type ActivationDirection = 'left' | 'right' | 'none';

// Helper: Get animation variants based on direction
const getAnimationVariants = (direction: ActivationDirection): Variants => {
  if (direction === 'none') {
    return {
      initial: {},
      animate: {},
      exit: {},
    };
  }
  return {
    initial: { x: direction === 'right' ? '100%' : '-100%', opacity: 0 },
    animate: { x: 0, opacity: 1 },
    exit: { x: direction === 'right' ? '-100%' : '100%', opacity: 0 },
  };
};

interface GroupedReaction {
  emojiName: string;
  count: number;
  users: Array<{ userId: string; name: string; user?: User | undefined }>;
  orderIndex: number;
}

// Helper: Group reactions by emoji
const groupReactionsByEmoji = (
  reactionsData: ReactionsData,
  usersById: Map<string, User>,
): GroupedReaction[] => {
  const emojiOrder = Object.keys(reactionsData);
  const grouped = emojiOrder.reduce(
    (acc, emoji, index) => {
      const userIds = reactionsData[emoji] ?? [];
      acc[emoji] = {
        emojiName: emoji,
        count: userIds.length,
        users: userIds.map(userId => {
          const user = usersById.get(userId);
          return {
            userId,
            name: user ? getUserDisplayName(user) : 'Unknown User',
            user,
          };
        }),
        orderIndex: index,
      };
      return acc;
    },
    {} as Record<string, GroupedReaction>,
  );

  return Object.values(grouped).sort((a, b) => {
    if (a.count !== b.count) {
      return b.count - a.count;
    }
    return a.orderIndex - b.orderIndex;
  });
};

export default function MobileReactionDrawer({
  isOpen,
  setIsOpen,
  reactionsMd,
}: {
  reactionsMd: string | null | undefined;
  isOpen: boolean;
  setIsOpen: (isOpen: boolean) => void;
}) {
  const { user: currentUser } = useAuth();
  const users = useUsers();
  const navigate = useNavigate();
  const location = useLocation();
  const usersById = useMemo(() => {
    const map = new Map<string, User>();
    for (const u of users) {
      map.set(u.id, u);
    }
    return map;
  }, [users]);

  const reactionsData = useMemo(() => parseReactionsMd(reactionsMd), [reactionsMd]);
  const groupedReactions = useMemo(
    () => groupReactionsByEmoji(reactionsData, usersById),
    [reactionsData, usersById],
  );

  // For "All" panel: group by emoji and show comma-separated names
  const allGroupedWithNames = useMemo(() => {
    return groupedReactions.map(group => ({
      emojiName: group.emojiName,
      userNames: group.users.map(u => u.name).join(', '),
    }));
  }, [groupedReactions]);

  const [activeTab, setActiveTab] = useState('all');
  const [swipeDirection, setSwipeDirection] = useState<'left' | 'right' | null>(null);

  // Auto-scroll active tab into view
  const tabsListRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (tabsListRef.current) {
      const activeTabElement = tabsListRef.current.querySelector('[data-active]');
      if (activeTabElement) {
        activeTabElement.scrollIntoView({
          behavior: 'smooth',
          block: 'nearest',
          inline: 'nearest',
        });
      }
    }
  }, [activeTab]);

  // Reset to "all" tab when drawer opens
  useEffect(() => {
    if (isOpen) {
      setActiveTab('all');
    }
  }, [isOpen]);

  // Get ordered list of all tab values
  const tabValues = useMemo(() => {
    return ['all', ...groupedReactions.map(r => r.emojiName)];
  }, [groupedReactions]);

  // Get current tab index
  const currentTabIndex = tabValues.indexOf(activeTab);

  // Swipe helper functions
  const swipeConfidenceThreshold = 10000;
  const swipePower = (offset: number, velocity: number) => {
    return Math.abs(offset) * velocity;
  };

  // Handle swipe navigation
  const paginate = (newDirection: number) => {
    const newIndex = currentTabIndex + newDirection;
    if (newIndex >= 0 && newIndex < tabValues.length) {
      // Reversed: when going forward (newDirection > 0), panel comes from right
      setSwipeDirection(newDirection > 0 ? 'right' : 'left');
      if (tabValues[newIndex]) setActiveTab(tabValues[newIndex]);
      // Reset swipe direction after animation
      setTimeout(() => setSwipeDirection(null), 300);
    }
  };

  // Handle tab click with direction
  const handleTabClick = (targetTab: string) => {
    const targetIndex = tabValues.indexOf(targetTab);
    const direction = targetIndex - currentTabIndex;
    if (direction !== 0) {
      setSwipeDirection(direction > 0 ? 'right' : 'left');
      setActiveTab(targetTab);
      setTimeout(() => setSwipeDirection(null), 300);
    }
  };

  function handleUserClick(id: string) {
    setIsOpen(false);
    void navigate(`${location.pathname}/profile/${id}`);
  }

  return (
    <Drawer.Root open={isOpen} onOpenChange={setIsOpen}>
      <Drawer.Portal>
        <Drawer.Overlay
          className='fixed inset-0 z-[100] bg-background/80 backdrop-blur-[2px]'
          onClick={() => setIsOpen(false)}
          onTouchStart={e => e.stopPropagation()}
          onTouchMove={e => e.stopPropagation()}
          onTouchEnd={e => e.stopPropagation()}
          onTouchCancel={e => e.stopPropagation()}
        />
        <Drawer.Content
          asChild
          className='fixed inset-x-0 bottom-0 z-[110] rounded-t-3xl border-t border-border bg-popover text-foreground'
          onTouchStart={e => e.stopPropagation()}
          onTouchMove={e => e.stopPropagation()}
          onTouchEnd={e => e.stopPropagation()}
          onTouchCancel={e => e.stopPropagation()}
        >
          <div className='p-4 py-2'>
            <Drawer.Handle />
            <Tabs.Root
              className='mt-2 grid grid-rows-[auto_1fr]'
              defaultValue='all'
              value={activeTab}
            >
              <Tabs.List
                ref={tabsListRef}
                className='relative z-0 flex gap-1 px-1 pb-1 border-b border-border overflow-x-auto [scrollbar-color:transparent_transparent]'
              >
                <Tabs.Tab
                  className='flex py-2 items-center justify-center gap-1 border-0 px-3 text-sm font-medium whitespace-nowrap text-muted-foreground outline-none select-none rounded-md ~hover:text-foreground ~hover:bg-accent ~focus-visible:ring-2 ~focus-visible:ring-ring data-[active]:text-foreground ~data-[active]:bg-accent'
                  value='all'
                  onClick={() => handleTabClick('all')}
                >
                  <span>All</span>
                  <span className='text-xs text-muted-foreground'>
                    {Object.values(reactionsData).reduce((sum, ids) => sum + ids.length, 0)}
                  </span>
                </Tabs.Tab>
                {groupedReactions.map(({ emojiName, count }) => (
                  <Tabs.Tab
                    key={emojiName}
                    className='flex py-2 items-center justify-center gap-1 border-0 px-3 text-sm font-medium whitespace-nowrap text-muted-foreground outline-none select-none rounded-md ~hover:text-foreground ~hover:bg-accent ~focus-visible:ring-2 ~focus-visible:ring-ring data-[active]:text-foreground ~data-[active]:bg-accent'
                    value={emojiName}
                    onClick={() => handleTabClick(emojiName)}
                  >
                    <span>{renderEmoji(emojiName)}</span>
                    <span className='text-xs text-muted-foreground'>{count}</span>
                  </Tabs.Tab>
                ))}
                <Tabs.Indicator className='absolute bottom-0 left-0 z-[-1] h-0.5 w-[var(--active-tab-width)] translate-x-[var(--active-tab-left)] rounded-t-sm bg-primary transition-all duration-200 ease-out' />
              </Tabs.List>

              {/* Single AnimatePresence wrapping all panels */}
              <AnimatePresence mode='wait' initial={false}>
                <motion.div
                  key={activeTab}
                  variants={getAnimationVariants(swipeDirection ?? 'none')}
                  initial='initial'
                  animate='animate'
                  exit='exit'
                  drag='x'
                  dragConstraints={{ left: 0, right: 0 }}
                  dragElastic={1}
                  onDragEnd={(_, { offset, velocity }) => {
                    const swipe = swipePower(offset.x, velocity.x);
                    if (swipe < -swipeConfidenceThreshold) {
                      paginate(1);
                    } else if (swipe > swipeConfidenceThreshold) {
                      paginate(-1);
                    }
                  }}
                  transition={{ duration: 0.2, ease: 'easeOut' }}
                  className='h-[80dvh] overflow-auto'
                >
                  {activeTab === 'all' ? (
                    <div className='py-3'>
                      {allGroupedWithNames.map((group, idx) => (
                        <button
                          key={idx}
                          onClick={() => paginate(idx + 1 - currentTabIndex)}
                          data-track-category='MESSAGE'
                          data-track-name='SWITCH_REACTION_TAB'
                          className='flex items-start gap-3 px-2 py-2 w-full text-left hover:bg-accent active:bg-accent rounded-lg transition-colors'
                        >
                          <span className='*:text-2xl flex-shrink-0'>
                            {renderEmoji(group.emojiName)}
                          </span>
                          <p className='text-sm self-center text-foreground line-clamp-3'>
                            {group.userNames}
                          </p>
                        </button>
                      ))}
                    </div>
                  ) : (
                    <div className='py-3 space-y-2'>
                      {groupedReactions
                        .find(g => g.emojiName === activeTab)
                        ?.users.map((user, idx) => (
                          <>
                            <button
                              onClick={() => handleUserClick(user.userId)}
                              data-track-category='MESSAGE'
                              data-track-name='OPEN_REACTOR_PROFILE'
                              key={idx}
                              className='flex items-center gap-3 px-2 py-2'
                            >
                              <Avatar userId={user.userId} size='sm' showActiveStatus={false} />
                              <span className='text-sm text-foreground truncate flex items-center gap-1'>
                                {user.name}
                                {user.user?.statusEmoji &&
                                  (!user.user.statusExpiryAt ||
                                    !isStatusExpired(user.user.statusExpiryAt)) && (
                                    <span className='inline-flex'>
                                      {renderEmoji(user.user.statusEmoji)}
                                    </span>
                                  )}
                                {currentUser && user.userId === currentUser.id && (
                                  <span className='text-muted-foreground'>(you)</span>
                                )}
                              </span>
                            </button>
                          </>
                        ))}
                    </div>
                  )}
                </motion.div>
              </AnimatePresence>
            </Tabs.Root>
          </div>
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}
