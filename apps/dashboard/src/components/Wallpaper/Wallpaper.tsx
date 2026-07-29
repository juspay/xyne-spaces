import { ReactElement } from 'react';

/**
 * Full-screen app background. Sits at a negative z-index behind all app content
 * (which renders over the now-transparent `--root-bg`) and covers the viewport.
 *
 * Two stacked layers, both driven entirely by per-theme CSS variables (set in
 * global.css) so adding a theme never requires touching this component:
 *
 *  1. `.app-wallpaper-image`   — the base photo   (`--wallpaper-image`)
 *  2. `.app-wallpaper-overlay` — a wash on top of it. Each theme picks EITHER a
 *     texture image OR a solid color via `--wallpaper-overlay`, plus its own
 *     `--wallpaper-overlay-opacity` and `--wallpaper-overlay-blur`.
 *
 * e.g. classic/summer_breeze use a near-white texture image + heavy blur;
 * midnight uses a solid `#222` at 80% with no blur.
 */
const Wallpaper = (): ReactElement => {
  return (
    <div aria-hidden='true' className='fixed inset-0 -z-10 pointer-events-none'>
      <div className='app-wallpaper-image absolute inset-0 bg-cover bg-center bg-no-repeat' />
      <div className='app-wallpaper-overlay absolute inset-0 size-full' />
    </div>
  );
};

export default Wallpaper;
