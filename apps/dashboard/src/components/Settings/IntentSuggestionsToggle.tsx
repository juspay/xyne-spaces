import type { ReactElement } from 'react';
import { Switch } from '../ui/Switch';
import { useIntentSuggestionsEnabled } from '../../hooks/useIntentSuggestionsEnabled';

/**
 * Settings → Developer switch for on-device intent suggestions.
 *
 * Mirrors ClawOverlayToggle: self-contained, owns its own hook, no props.
 * See docs/ON_DEVICE_INTENT.md
 */
export function IntentSuggestionsToggle(): ReactElement {
  const { intentSuggestionsEnabled, setIntentSuggestionsEnabled } = useIntentSuggestionsEnabled();

  return (
    <div className='flex items-center justify-between gap-4 rounded-lg border border-border bg-muted/30 p-3'>
      <div>
        <p className='text-sm font-medium text-foreground'>Intent suggestions</p>
        <p className='mt-0.5 text-xs text-muted-foreground'>
          Suggests starting a call when a message in a public channel reads like you are trying to
          get on one. Runs entirely on your device.
        </p>
      </div>
      <Switch
        id='intent-suggestions'
        checked={intentSuggestionsEnabled}
        onCheckedChange={setIntentSuggestionsEnabled}
      />
    </div>
  );
}
