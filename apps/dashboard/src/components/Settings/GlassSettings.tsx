import type { ReactElement } from 'react';
import { useGlassSettings } from '../../hooks/useGlassSettings';
import { GlassEffectToggle } from './GlassEffectToggle';
import { WallpaperOpacityControl } from './WallpaperOpacityControl';

export function GlassSettings(): ReactElement | null {
  const { enabled, isSupported, setEnabled } = useGlassSettings();

  if (!isSupported) return null;

  return (
    <div className='overflow-hidden rounded-lg border border-border bg-muted/30'>
      <GlassEffectToggle enabled={enabled} onChange={setEnabled} />
      {enabled && <WallpaperOpacityControl />}
    </div>
  );
}
