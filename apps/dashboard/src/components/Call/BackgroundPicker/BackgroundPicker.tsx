import { useRef, useState } from 'react';
import { useSelector } from '@xstate/react';
import { Ban, Loader2, Plus, Sparkles, X } from 'lucide-react';
import { toast } from 'sonner';
import { roomActor } from '../../../machines/roomMachine';
import { supportsBackgroundEffects } from '../../../utils/backgroundEffects';
import { cn } from '../../../utils/classNames';
import {
  type BackgroundEffect,
  type CustomBackground,
  MAX_CUSTOM_BACKGROUNDS,
  NO_BACKGROUND_EFFECT,
  PRESET_BACKGROUNDS,
  imageFileToBackgroundDataUrl,
  isSameEffect,
  loadCustomBackgrounds,
  saveCustomBackgrounds,
} from '../../../utils/callBackground';

interface BackgroundPickerProps {
  callId?: string | undefined;
  className?: string | undefined;
}

/**
 * Google-Meet-style background chooser for the local camera: no effect,
 * light/strong blur, preset images, and up to {@link MAX_CUSTOM_BACKGROUNDS}
 * uploads kept in this browser only (never sent to the server).
 * The effect is previewed live on the local participant tile.
 */
export function BackgroundPicker({ callId, className }: BackgroundPickerProps): React.ReactElement {
  const effect = useSelector(roomActor, state => state.context.backgroundEffect);
  const [customBackgrounds, setCustomBackgrounds] = useState<CustomBackground[]>(() =>
    loadCustomBackgrounds(),
  );
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const select = (next: BackgroundEffect): void => {
    roomActor.send({ type: 'SET_BACKGROUND_EFFECT', effect: next });
  };

  const handleUpload = async (file: File): Promise<void> => {
    if (!file.type.startsWith('image/')) {
      toast.error('Please choose an image file');
      return;
    }
    setIsUploading(true);
    try {
      const url = await imageFileToBackgroundDataUrl(file);
      const custom: CustomBackground = { id: `custom-${Date.now()}`, url };
      const next = [custom, ...customBackgrounds].slice(0, MAX_CUSTOM_BACKGROUNDS);
      if (!saveCustomBackgrounds(next)) {
        // Still usable for this call, just not remembered next time.
        toast.warning('Background applied, but could not be saved for future calls');
      }
      setCustomBackgrounds(next);
      select({ mode: 'image', id: custom.id, url: custom.url });
    } catch {
      toast.error('Could not load that image');
    } finally {
      setIsUploading(false);
    }
  };

  const removeCustom = (id: string): void => {
    const next = customBackgrounds.filter(c => c.id !== id);
    saveCustomBackgrounds(next);
    setCustomBackgrounds(next);
    if (effect.mode === 'image' && effect.id === id) select(NO_BACKGROUND_EFFECT);
  };

  if (!supportsBackgroundEffects()) {
    return (
      <div className={cn('w-72 p-4 text-sm text-[#c4c7c5]', className)}>
        Background effects aren&apos;t supported in this browser.
      </div>
    );
  }

  const tileClass = (selected: boolean): string =>
    cn(
      'relative flex aspect-video items-center justify-center overflow-hidden rounded-lg',
      'bg-[#333537] text-[#e3e3e3] transition hover:bg-[#404245]',
      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#a8c7fa]',
      selected ? 'ring-2 ring-[#a8c7fa]' : 'ring-1 ring-inset ring-white/10',
    );

  const imageTile = (
    id: string,
    label: string,
    url: string,
    thumbUrl: string,
  ): React.ReactElement => {
    const next: BackgroundEffect = { mode: 'image', id, url };
    return (
      <button
        type='button'
        onClick={() => select(next)}
        className={tileClass(isSameEffect(effect, next))}
        title={label}
        aria-label={label}
        aria-pressed={isSameEffect(effect, next)}
        data-track-category='CALLS'
        data-track-name='SET_BACKGROUND_EFFECT'
        data-track-metadata={JSON.stringify({
          option: id.startsWith('custom-') ? 'custom' : id,
          callId,
        })}
      >
        <img src={thumbUrl} alt='' className='h-full w-full object-cover' loading='lazy' />
      </button>
    );
  };

  return (
    <div className={cn('w-[min(22rem,calc(100vw-2rem))] p-3', className)}>
      <div className='mb-2 text-sm font-medium text-[#e3e3e3]'>Backgrounds</div>

      <div className='mb-1.5 text-xs text-[#c4c7c5]'>Blur</div>
      <div className='mb-3 grid grid-cols-3 gap-2'>
        <button
          type='button'
          onClick={() => select(NO_BACKGROUND_EFFECT)}
          className={tileClass(effect.mode === 'none')}
          title='No effect'
          aria-label='No effect'
          aria-pressed={effect.mode === 'none'}
          data-track-category='CALLS'
          data-track-name='SET_BACKGROUND_EFFECT'
          data-track-metadata={JSON.stringify({ option: 'none', callId })}
        >
          <Ban className='h-5 w-5' />
        </button>
        {(['light', 'strong'] as const).map(strength => {
          const next: BackgroundEffect = { mode: 'blur', strength };
          const label = strength === 'light' ? 'Slightly blur' : 'Blur';
          return (
            <button
              key={strength}
              type='button'
              onClick={() => select(next)}
              className={tileClass(isSameEffect(effect, next))}
              title={label}
              aria-label={label}
              aria-pressed={isSameEffect(effect, next)}
              data-track-category='CALLS'
              data-track-name='SET_BACKGROUND_EFFECT'
              data-track-metadata={JSON.stringify({ option: `blur-${strength}`, callId })}
            >
              <Sparkles className={strength === 'light' ? 'h-4 w-4' : 'h-6 w-6'} />
            </button>
          );
        })}
      </div>

      <div className='mb-1.5 text-xs text-[#c4c7c5]'>Images</div>
      <div className='grid max-h-64 grid-cols-3 gap-2 overflow-y-auto p-0.5'>
        <button
          type='button'
          onClick={() => fileInputRef.current?.click()}
          disabled={isUploading}
          className={tileClass(false)}
          title='Upload a background image'
          aria-label='Upload a background image'
          data-track-category='CALLS'
          data-track-name='UPLOAD_BACKGROUND_IMAGE'
          data-track-metadata={JSON.stringify({ callId })}
        >
          {isUploading ? (
            <Loader2 className='h-5 w-5 animate-spin' />
          ) : (
            <Plus className='h-5 w-5' />
          )}
        </button>
        {customBackgrounds.map(custom => (
          <div key={custom.id} className='group relative'>
            {imageTile(custom.id, 'Your background', custom.url, custom.url)}
            <button
              type='button'
              onClick={() => removeCustom(custom.id)}
              className='absolute right-1 top-1 rounded-full bg-black/60 p-0.5 text-white opacity-0 transition-opacity hover:bg-black/80 focus-visible:opacity-100 group-hover:opacity-100'
              title='Remove background'
              aria-label='Remove background'
              data-track-category='CALLS'
              data-track-name='REMOVE_BACKGROUND_IMAGE'
              data-track-metadata={JSON.stringify({ callId })}
            >
              <X className='h-3 w-3' />
            </button>
          </div>
        ))}
        {PRESET_BACKGROUNDS.map(p => (
          <div key={p.id}>{imageTile(p.id, p.label, p.url, p.thumbUrl)}</div>
        ))}
      </div>

      <input
        ref={fileInputRef}
        type='file'
        accept='image/*'
        className='hidden'
        onChange={e => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (file) void handleUpload(file);
        }}
      />
    </div>
  );
}
