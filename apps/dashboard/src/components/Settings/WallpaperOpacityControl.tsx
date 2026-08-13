import type { ReactElement } from 'react';
import { Slider } from 'radix-ui';
import { useWallpaperOpacity } from '../../hooks/useWallpaperOpacity';
import { themeLabel } from '../../hooks/useTheme';
import {
  WALLPAPER_OPACITY_MAX,
  WALLPAPER_OPACITY_MIN,
  WALLPAPER_OPACITY_STEP,
} from '../../stores/wallpaperOpacityStore';

export function WallpaperOpacityControl(): ReactElement {
  const { theme, value, isCustom, setValue, reset } = useWallpaperOpacity();

  return (
    <div className='flex items-center justify-between gap-4 border-t border-border p-3'>
      <div className='min-w-0 flex-1'>
        <div className='flex items-center gap-2'>
          <p className='truncate text-sm font-medium text-foreground'>Wallpaper</p>
          <span className='shrink-0 rounded-full border border-border bg-background px-1.5 py-0.5 text-[10px] font-medium leading-none text-muted-foreground'>
            {themeLabel(theme)}
          </span>
        </div>
        <div className='mt-0.5 flex items-center gap-2'>
          <p className='truncate text-xs text-muted-foreground'>Blend wallpaper over the glass</p>
          {isCustom && (
            <button
              type='button'
              onClick={reset}
              className='shrink-0 text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground'
              data-track-category='PREFERENCES'
              data-track-name='ResetWallpaperOpacity'
            >
              Reset
            </button>
          )}
        </div>
      </div>
      <div className='flex w-2/5 min-w-[132px] max-w-[220px] shrink-0 items-center gap-3'>
        <Slider.Root
          className='relative flex h-4 flex-1 touch-none select-none items-center'
          min={WALLPAPER_OPACITY_MIN}
          max={WALLPAPER_OPACITY_MAX}
          step={WALLPAPER_OPACITY_STEP}
          value={[value]}
          onValueChange={next => {
            const first = next[0];
            if (typeof first === 'number') {
              setValue(first);
            }
          }}
          aria-label='Wallpaper opacity'
        >
          <Slider.Track className='relative h-1 w-full grow rounded-full bg-border'>
            <Slider.Range className='absolute h-full rounded-full bg-primary' />
          </Slider.Track>
          <Slider.Thumb className='block size-3.5 rounded-full border border-border bg-background shadow-sm outline-none focus-visible:ring-2 focus-visible:ring-ring' />
        </Slider.Root>
        <span className='w-10 shrink-0 text-right text-xs tabular-nums text-muted-foreground'>
          {value}%
        </span>
      </div>
    </div>
  );
}
