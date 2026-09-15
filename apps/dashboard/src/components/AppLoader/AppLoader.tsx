import { ReactElement } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useLoadingAnimationLog } from '../../hooks/useLoadingAnimationLog';
import { Event } from '../../utils/logger';
import { detectReactNativeWebView } from '../../utils/reactNativeBridge';
import { AppLoaderMark } from './AppLoaderMark';

const AppLoader = (): ReactElement => {
  const isNativeWebView = detectReactNativeWebView();

  useLoadingAnimationLog({
    event: Event.APP_LOADER_HIDDEN,
    source: 'AppLoader',
    message: 'App loader animation hidden',
  });

  return isNativeWebView ? (
    <></>
  ) : (
    <AnimatePresence>
      <motion.div
        key='app-loader'
        initial={{ opacity: 1 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0, backdropFilter: 'blur(4px)' }}
        transition={{ duration: 0.3, ease: 'easeOut' }}
        className='fixed inset-0 flex flex-col gap-4 items-center justify-center z-[1000] backdrop-blur-lg'
        style={{ background: 'var(--root-bg)' }}
      >
        <div className='absolute inset-0 backdrop-blur-3xl'></div>
        <AppLoaderMark size='lg' className='z-[1100]' />
      </motion.div>
    </AnimatePresence>
  );
};

export default AppLoader;
