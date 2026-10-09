import { useEffect, useRef, useState, type ReactElement, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Settings } from 'lucide-react';
import { toast } from 'sonner';
import { pickVoice, ttsService, ttsVoicesQuery } from '../../services/VoiceInput/ttsService';
import { Popover } from '../ui/Popover';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/Select';
import { Switch } from '../ui/Switch';
import { IconButton } from './VoiceControls';
import { updateVoiceSettings, useVoiceSettings } from './voiceSettings';

// Select items need a non-empty value, so the default microphone gets one.
const DEFAULT_MIC = 'default';

// Browsers list these aliases next to the real devices.
const MIC_ALIASES = ['default', 'communications'];

// Labels are only filled in once the microphone has been allowed, so unnamed devices are left out.
function useMicrophones(): MediaDeviceInfo[] {
  const [mics, setMics] = useState<MediaDeviceInfo[]>([]);
  useEffect(() => {
    const load = (): void => {
      navigator.mediaDevices?.enumerateDevices().then(
        devices =>
          setMics(
            devices.filter(
              d => d.kind === 'audioinput' && d.label && !MIC_ALIASES.includes(d.deviceId),
            ),
          ),
        () => setMics([]),
      );
    };
    load();
    navigator.mediaDevices?.addEventListener('devicechange', load);
    return (): void => navigator.mediaDevices?.removeEventListener('devicechange', load);
  }, []);
  return mics;
}

function Field({ label, children }: { label: string; children: ReactNode }): ReactElement {
  return (
    <label className='flex flex-col gap-1.5 text-xs font-medium text-muted-foreground'>
      {label}
      {children}
    </label>
  );
}

function SettingsPanel(): ReactElement {
  const { voiceId, speakReplies, micId } = useVoiceSettings();
  const mics = useMicrophones();
  const { data: catalog } = useQuery(ttsVoicesQuery);
  const voices = catalog?.voices ?? [];
  const voice = pickVoice(catalog, voiceId);
  const micValue = mics.find(mic => mic.deviceId === micId)?.deviceId ?? DEFAULT_MIC;
  const previewRef = useRef<HTMLAudioElement | null>(null);

  const chooseVoice = async (id: string): Promise<void> => {
    updateVoiceSettings({ voiceId: id });
    const name = voices.find(option => option.id === id)?.name ?? '';
    try {
      const { audioBase64, mimeType } = await ttsService.synthesize(
        `Hi, I'm ${name}. This is how I sound.`,
        id,
      );
      previewRef.current?.pause();
      previewRef.current = new Audio(`data:${mimeType};base64,${audioBase64}`);
      await previewRef.current.play();
    } catch {
      toast.error('Could not play a preview of this voice');
    }
  };

  return (
    <div className='flex w-64 flex-col gap-3'>
      {voices.length > 0 && (
        <Field label='Voice'>
          <Select value={voice?.id ?? ''} onValueChange={id => void chooseVoice(id)}>
            <SelectTrigger size='sm' className='w-full'>
              <SelectValue>{voice?.name}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {voices.map(option => (
                <SelectItem key={option.id} value={option.id}>
                  {option.name}
                  <span className='text-xs text-muted-foreground'> · {option.description}</span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      )}
      <Field label='Microphone'>
        <Select
          value={micValue}
          onValueChange={id => updateVoiceSettings({ micId: id === DEFAULT_MIC ? null : id })}
        >
          <SelectTrigger size='sm' className='w-full'>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={DEFAULT_MIC}>Default microphone</SelectItem>
            {mics.map(mic => (
              <SelectItem key={mic.deviceId} value={mic.deviceId}>
                {mic.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      <div className='flex items-center justify-between text-sm'>
        Speak replies
        <Switch
          aria-label='Speak replies'
          checked={speakReplies}
          onCheckedChange={checked => updateVoiceSettings({ speakReplies: checked })}
        />
      </div>
    </div>
  );
}

/** The gear that opens the voice settings: voice, microphone and whether replies are spoken. */
export function VoiceSettingsPopover(): ReactElement {
  return (
    <Popover
      side='top'
      className='p-3'
      trigger={
        <IconButton
          label='Voice settings'
          data-track-category='XyneAI'
          data-track-name='VOICE_MODE_SETTINGS'
        >
          <Settings />
        </IconButton>
      }
    >
      <SettingsPanel />
    </Popover>
  );
}
