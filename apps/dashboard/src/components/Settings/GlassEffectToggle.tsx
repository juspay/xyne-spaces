import type { ReactElement } from 'react';
import { Switch } from '../ui/Switch';
import { useGlassSettings } from '../../hooks/useGlassSettings';

export function GlassEffectToggle(): ReactElement | null {
  const { enabled, isSupported, setEnabled } = useGlassSettings();

  if (!isSupported) return null;

  return (
    <div className='flex items-center justify-between gap-4 rounded-lg border border-border bg-muted/30 p-3'>
      <div>
        <p className='text-sm font-medium text-foreground'>Glass effect</p>
        <p className='mt-0.5 text-xs text-muted-foreground'>
          Blurs your desktop through the app background instead of a wallpaper
        </p>
      </div>
      <Switch id='glass-effect' checked={enabled} onCheckedChange={setEnabled} />
    </div>
  );
}
