import { ReactElement } from 'react';

/**
 * Full-screen app background. Light themes paint an opaque `--root-bg`, while
 * Midnight keeps that surface transparent so this wallpaper remains visible.
 */
const Wallpaper = (): ReactElement => {
  return (
    <div aria-hidden='true' className='fixed inset-0 -z-10 pointer-events-none'>
      <div className='app-wallpaper-image absolute inset-0 bg-cover bg-center bg-no-repeat' />
    </div>
  );
};

export default Wallpaper;
