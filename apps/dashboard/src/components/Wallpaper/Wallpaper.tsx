import { ReactElement } from 'react';
import { useGlassActive, useGlassResolved } from '@/hooks/useGlassMode';

/**
 * Full-screen app background. Sits at a negative z-index behind all app content
 * (which renders over the now-transparent `--root-bg`) and covers the viewport.
 *
 * The photo is driven entirely by a per-theme CSS variable (`--wallpaper-image`,
 * set in global.css) so adding a theme never requires touching this component.
 */
const Wallpaper = (): ReactElement | null => {
  const glassActive = useGlassActive();
  const glassResolved = useGlassResolved();

  // Hold the paint for the one frame it takes the main process to answer.
  // Rendering the photo first and tearing it down a frame later flashes a
  // full-screen image on every launch of a vibrant window.
  if (!glassResolved || glassActive) {
    return null;
  }

  return (
    <div aria-hidden='true' className='fixed inset-0 -z-10 pointer-events-none'>
      <div className='app-wallpaper-image absolute inset-0 bg-cover bg-center bg-no-repeat' />
    </div>
  );
};

export default Wallpaper;
