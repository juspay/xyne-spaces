import { Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import { ReactElement } from 'react';
import { Event } from '../../utils/logger';
import { useLoadingAnimationLog } from '../../hooks/useLoadingAnimationLog';

const SplashScreen = (): ReactElement => {
  const { isLoading } = useAuth();

  if (isLoading) {
    return <SplashLoadingScreen />;
  }
  return <Outlet></Outlet>;
};

const SplashLoadingScreen = (): ReactElement => {
  const location = useLocation();

  useLoadingAnimationLog({
    event: Event.SPLASH_SCREEN_HIDDEN,
    source: 'splash_screen',
    message: 'splash screen loading',
    url: location.pathname,
  });
  return (
    <div className='min-h-screen flex items-center justify-center'>
      <div className='text-center'>
        <div className='mb-8'>
          <div className='w-20 h-20 mx-auto mb-4 rounded-full flex items-center justify-center'>
            <div className='w-12 h-12 border-4 border-blue-600 border-t-transparent rounded-full animate-spin'></div>
          </div>
          <h1 className='text-2xl opacity-90 font-bold mb-2'>Xyne Spaces</h1>
          <p className='text-blue-700'>Workflow Automation Dashboard</p>
        </div>
      </div>
    </div>
  );
};

export default SplashScreen;
