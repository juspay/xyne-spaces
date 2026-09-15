import { ReactElement, useMemo, useState, useCallback, Ref } from 'react';
import Avatar from '../Avatar/Avatar';
import { Drawer } from 'vaul';
import ProfileView from '../../Settings/Views/ProfileView';
import Preferences from '../../Settings/Preferences';
import {
  StatusSuggestionsView,
  StatusEditView,
  SelectedStatusData,
} from '../../Settings/Views/SetStatusView';
import { useMeasure } from 'react-use';
import { AnimatePresence, motion } from 'framer-motion';
import { useUser } from '../../../hooks/useUsers';
import { isStatusExpired } from '../../../utils/statusUtils';
import { renderEmoji } from '../../../utils/customEmojiUtils';

interface MobileProfileMenuProps {
  userId: string;
}

type ViewType = 'default' | 'status-suggestions' | 'status-edit';

export const MobileProfileMenu = ({ userId }: MobileProfileMenuProps): ReactElement => {
  const [isOpen, setIsOpen] = useState<boolean>(false);
  const [isPreferencesOpen, setIsPreferencesOpen] = useState<boolean>(false);
  const [view, setView] = useState<ViewType>('default');
  const [statusData, setStatusData] = useState<SelectedStatusData | undefined>(undefined);
  const [elementRef, bounds] = useMeasure();

  const handleSetView = useCallback((newView: ViewType, data?: SelectedStatusData) => {
    setView(newView);
    setStatusData(data);
  }, []);

  const user = useUser(userId);
  const hasValidStatus = useMemo(() => {
    return user?.statusEmoji && (!user?.statusExpiryAt || !isStatusExpired(user.statusExpiryAt));
  }, [user?.statusEmoji, user?.statusExpiryAt]);

  const content = useMemo(() => {
    switch (view) {
      case 'default':
        return (
          <ProfileView
            setView={handleSetView}
            onClose={() => setIsOpen(false)}
            onOpenPreferences={() => setIsPreferencesOpen(true)}
          />
        );
      case 'status-suggestions':
        return <StatusSuggestionsView setView={handleSetView} />;
      case 'status-edit':
        return (
          <StatusEditView
            {...(statusData && { initialData: statusData })}
            setView={handleSetView}
          />
        );
    }
  }, [view, statusData, handleSetView]);
  return (
    <>
      <button
        type='button'
        className='relative flex items-center gap-1.5'
        aria-label='Open user menu'
        onClick={() => {
          setView('default');
          setIsOpen(true);
        }}
        data-track-category='MOBILE_PROFILE_MENU'
        data-track-name='OPEN_USER_MENU'
      >
        {hasValidStatus && (
          <span className='text-[19px] leading-none flex items-center justify-center shrink-0'>
            {renderEmoji(user?.statusEmoji || '')}
          </span>
        )}
        <Avatar userId={userId} size='md' className='shrink-0' />
      </button>
      <Drawer.Root open={isOpen} onOpenChange={setIsOpen}>
        <Drawer.Portal>
          <Drawer.Overlay
            className='fixed inset-0 z-50 bg-background/80 backdrop-blur-[2px]'
            onClick={() => setIsOpen(false)}
            data-track-category='MOBILE_PROFILE_MENU'
            data-track-name='CLOSE_USER_MENU_BACKDROP'
          />
          <Drawer.Content
            asChild
            className='fixed inset-x-0 bottom-0 z-50 rounded-t-3xl border-t border-border bg-background text-foreground max-h-[90dvh]'
          >
            <motion.div
              animate={{
                height: bounds.height,
                transition: {
                  duration: 0.27,
                  ease: [0.25, 1, 0.5, 1],
                },
              }}
            >
              <div
                ref={elementRef as Ref<HTMLDivElement> | undefined}
                className='overflow-y-auto max-h-[90dvh]'
              >
                <AnimatePresence initial={false} mode='popLayout' custom={view}>
                  <motion.div
                    key={view}
                    initial={{ opacity: 0, scale: 0.96 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.96 }}
                    transition={{ duration: 0.27, ease: [0.26, 0.08, 0.25, 1] }}
                  >
                    {content}
                  </motion.div>
                </AnimatePresence>
              </div>
            </motion.div>
          </Drawer.Content>
        </Drawer.Portal>
      </Drawer.Root>
      <Preferences open={isPreferencesOpen} onClose={() => setIsPreferencesOpen(false)} />
    </>
  );
};
