import { ReactElement } from 'react';
import { useSyncExternalStore } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { isSwitchOverlayVisible, subscribeSwitchOverlay } from '../../stores/switchOverlayStore';

export const SwitchLoadingOverlay = (): ReactElement | null => {
  const visible = useSyncExternalStore(
    subscribeSwitchOverlay,
    isSwitchOverlayVisible,
    isSwitchOverlayVisible,
  );

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          key='switch-loading-overlay'
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2, ease: 'easeOut' }}
          className='fixed inset-0 z-[2000] flex flex-col items-center justify-center gap-6 backdrop-blur-lg'
          style={{ background: 'rgba(15, 15, 20, 0.35)' }}
        >
          <img
            src='/images/xyne_logo_loading.png'
            alt='Switching environment'
            className='h-[72px] w-[72px]'
            loading='eager'
            decoding='async'
          />
          <motion.div
            className='h-9 w-9 rounded-full border-2 border-white/25 border-t-white'
            animate={{ rotate: 360 }}
            transition={{ repeat: Infinity, ease: 'linear', duration: 0.8 }}
          />
        </motion.div>
      )}
    </AnimatePresence>
  );
};

export default SwitchLoadingOverlay;
