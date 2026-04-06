import { useEffect, type ReactElement } from 'react';
import { useLocation } from 'react-router-dom';
import { useAIOnboarding } from '../../contexts/AIOnboardingContext';
import { usePlatform } from '../../hooks/usePlatform';

export const AIOnboardingOverlay = (): ReactElement | null => {
  const { state } = useAIOnboarding();
  const { isMobile } = usePlatform();
  const location = useLocation();
  const isOnOnboardingRoute = location.pathname === '/onboarding';

  const shouldShow = state.isActive && !isMobile && !isOnOnboardingRoute;

  // Block Escape key during onboarding (only when overlay is shown)
  useEffect(() => {
    if (!shouldShow) return;

    const handleKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
      }
    };

    // Use capture phase to intercept before other handlers
    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [shouldShow]);

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
    />
  );
};
