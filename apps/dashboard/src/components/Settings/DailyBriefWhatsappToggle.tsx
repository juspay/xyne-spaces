import { useEffect, useState, type ReactElement } from 'react';
import { Switch } from '../ui/Switch';
import { dailyBriefApi } from '../../api/dailyBriefApi';

/**
 * Sub-setting under "Morning brief": also send it to the user's linked
 * WhatsApp. On by default; the same switch is reachable from WhatsApp with
 * `/brief off|on`.
 */
export function DailyBriefWhatsappToggle(): ReactElement | null {
  const [state, setState] = useState<{ enabled: boolean; linked: boolean } | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    let alive = true;
    dailyBriefApi
      .getConfig()
      .then((cfg) => alive && setState({ enabled: cfg.whatsappEnabled, linked: cfg.whatsappLinked }))
      .catch(() => alive && setError(true));
    return () => {
      alive = false;
    };
  }, []);

  if (!state) return null;

  const onChange = (next: boolean) => {
    const prev = state.enabled;
    setState({ ...state, enabled: next });
    setSaving(true);
    setError(false);
    dailyBriefApi
      .saveConfig({ whatsappEnabled: next })
      .then((cfg) => setState({ enabled: cfg.whatsappEnabled, linked: cfg.whatsappLinked }))
      .catch(() => {
        setState((s) => (s ? { ...s, enabled: prev } : s));
        setError(true);
      })
      .finally(() => setSaving(false));
  };

  return (
    <div className='mt-3 flex items-center justify-between gap-4 pl-3' data-track-name='daily-brief-whatsapp-toggle'>
      <div>
        <p className='text-sm text-foreground'>Also send to WhatsApp</p>
        <p className='mt-0.5 text-xs text-muted-foreground'>
          {state.linked
            ? 'A short version each morning. Reply /brief off in WhatsApp to stop.'
            : 'Link your WhatsApp number to Xyne to receive it there.'}
        </p>
        {error && <p className='mt-1 text-xs text-destructive'>Couldn’t save — try again.</p>}
      </div>
      <Switch
        id='daily-brief-whatsapp-enabled'
        checked={state.enabled}
        disabled={saving}
        onCheckedChange={onChange}
      />
    </div>
  );
}
