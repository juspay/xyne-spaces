import { useEffect, type ReactElement } from 'react';
import { useLocation } from 'react-router-dom';
import { useSelector } from '@xstate/react';
import { useAIOnboarding } from '../../contexts/AIOnboardingContext';
import { usePlatform } from '../../hooks/usePlatform';
import { xyneAIActor } from '../../machines/xyneAIMachine';

export const AIOnboardingOverlay = (): ReactElement | null => {
  const { state, completeOnboarding } = useAIOnboarding();
  const { isMobile } = usePlatform();
  const location = useLocation();
  const isOnOnboardingRoute = location.pathname === '/onboarding';
  const isXyneAIOpen = useSelector(xyneAIActor, s => s.matches('open'));

  // Only show overlay when AI onboarding is active AND the XyneAI sidebar is actually open.
  // This prevents a stuck blur when the sidebar fails to open or the user navigates away.
  const shouldShow = state.isActive && !isMobile && !isOnOnboardingRoute && isXyneAIOpen;

  // Allow Escape key to dismiss the overlay
  useEffect(() => {
    if (!shouldShow) return;

    const handleKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        completeOnboarding();
      }
    };

    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [shouldShow, completeOnboarding]);

  if (!shouldShow) return null;

  return (
    <div
      className='fixed inset-0 bg-black/60 backdrop-blur-md z-[55]'
      onClick={e => {
        e.stopPropagation();
        e.preventDefault();
      }}
      aria-hidden='true'
      data-track-category='AIOnboarding'
      data-track-name='OverlayClick'
    >
      <button
        onClick={e => {
          e.stopPropagation();
          completeOnboarding();
        }}
        className='absolute top-4 left-4 px-4 py-2 bg-white/10 hover:bg-white/20 text-white rounded-lg text-sm font-medium transition-colors z-[56] cursor-pointer'
        aria-label='Skip AI onboarding'
        data-track-category='AIOnboarding'
        data-track-name='SkipButton'
      >
        Skip
      </button>
    </div>
  );
};
