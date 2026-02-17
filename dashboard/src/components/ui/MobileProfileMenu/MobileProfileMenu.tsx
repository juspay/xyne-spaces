import { ReactElement, useMemo, useState, useCallback, Ref } from 'react';
import Avatar from '../Avatar/Avatar';
import { Drawer } from 'vaul';
import ProfileView from '../../Settings/Views/ProfileView';
import {
  StatusSuggestionsView,
  StatusEditView,
  SelectedStatusData,
} from '../../Settings/Views/SetStatusView';
import { useMeasure } from 'react-use';
import { AnimatePresence, motion } from 'framer-motion';
interface MobileProfileMenuProps {
  userId: string;
}

type ViewType = 'default' | 'status-suggestions' | 'status-edit';

export const MobileProfileMenu = ({ userId }: MobileProfileMenuProps): ReactElement => {
  const [isOpen, setIsOpen] = useState<boolean>(false);
  const [view, setView] = useState<ViewType>('default');
  const [statusData, setStatusData] = useState<SelectedStatusData | undefined>(undefined);
  const [elementRef, bounds] = useMeasure();
  const handleSetView = useCallback((newView: ViewType, data?: SelectedStatusData) => {
    setView(newView);
    setStatusData(data);
  }, []);

  const content = useMemo(() => {
    switch (view) {
      case 'default':
        return <ProfileView setView={handleSetView} />;
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
        className='relative'
        aria-label='Open user menu'
        onClick={() => {
          setView('default');
          setIsOpen(true);
        }}
      >
        <Avatar userId={userId} size='md' />
      </button>
      <Drawer.Root open={isOpen} onOpenChange={setIsOpen}>
        <Drawer.Portal>
          <Drawer.Overlay
            className='fixed inset-0 z-50 bg-black/30'
            onClick={() => setIsOpen(false)}
          />
          <Drawer.Content
            asChild
            className='fixed inset-x-0 bottom-0 z-50 rounded-t-3xl bg-white max-h-[90dvh] overflow-auto'
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
              <div ref={elementRef as Ref<HTMLDivElement> | undefined}>
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
    </>
  );
};
