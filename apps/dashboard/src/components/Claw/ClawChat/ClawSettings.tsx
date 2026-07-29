import type { ReactElement } from 'react';
import { ArrowLeft } from 'lucide-react';
import { Switch } from '../../ui/Switch';
import { useClawOverlaySettings } from '../../../hooks/useClawOverlaySettings';

interface ClawSettingsProps {
  onBack: () => void;
}

export function ClawSettings({ onBack }: ClawSettingsProps): ReactElement {
  const { enabled, isSupported, setEnabled } = useClawOverlaySettings();

  return (
    <div className='flex h-full min-h-0 flex-col'>
      <div className='flex shrink-0 items-center gap-2 px-3 py-2.5'>
        <button
          type='button'
          onClick={onBack}
          aria-label='Back'
          data-track-category='CLAW_CHAT'
          data-track-name='SETTINGS_BACK'
          className='flex size-7 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground'
        >
          <ArrowLeft className='size-4' />
        </button>
        <span className='text-sm font-semibold text-foreground'>Settings</span>
      </div>

      <div className='min-h-0 flex-1 overflow-y-auto px-3 pb-3'>
        <div className='flex items-center justify-between gap-3 rounded-lg border border-border bg-muted/30 p-3'>
          <div className='min-w-0'>
            <p className='text-sm font-medium text-foreground'>Claw</p>
            <p className='mt-0.5 text-xs text-muted-foreground'>
              {enabled
                ? 'Turning this off hides Claw. You can bring it back from Preferences.'
                : 'Claw is off.'}
            </p>
          </div>
          <Switch
            id='claw-overlay-panel'
            checked={enabled}
            disabled={!isSupported}
            onCheckedChange={setEnabled}
          />
        </div>
      </div>
    </div>
  );
}
