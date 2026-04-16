import React from 'react';
import Lottie from 'lottie-react';
import loadingAnimationData from './animation.json';
import { useLoadingAnimationLog } from '../../../hooks/useLoadingAnimationLog';
import { Event } from '../../../utils/logger';

interface LoadingAnimationProps {
  size?: number;
  className?: string;
  message?: string;
  source?: string;
  url?: string;
}

const LoadingAnimation: React.FC<LoadingAnimationProps> = ({
  size = 200,
  className = '',
  message = 'unknown',
  source = 'unknown',
  url,
}) => {
  useLoadingAnimationLog({
    event: Event.LOADING_ANIMATION_HIDDEN,
    source,
    message,
    ...(url && { url }),
  });

  return (
    <div className={`flex flex-col items-center justify-center ${className}`}>
      <div style={{ width: size, height: size }}>
        <Lottie
          animationData={loadingAnimationData}
          loop={true}
          autoplay={true}
          style={{ width: '100%', height: '100%' }}
        />
      </div>
      {message && <p className='mt-1 text-foreground text-sm'>{message}</p>}
    </div>
  );
};

export default LoadingAnimation;
