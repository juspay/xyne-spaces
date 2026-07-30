import { ReactElement } from 'react';

/**
 * Full-screen app background. Sits at a negative z-index behind all app content
 * (which renders over the now-transparent `--root-bg`) and covers the viewport.
 *
 * The photo is driven entirely by a per-theme CSS variable (`--wallpaper-image`,
 * set in global.css) so adding a theme never requires touching this component.
 */
const Wallpaper = (): ReactElement => {
  return (
    <div aria-hidden='true' className='fixed inset-0 -z-10 pointer-events-none'>
      <div className='app-wallpaper-image absolute inset-0 bg-cover bg-center bg-no-repeat' />
    </div>
  );
};

export default Wallpaper;
