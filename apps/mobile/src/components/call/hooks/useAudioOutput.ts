/**
 * Audio route control for the call.
 *
 * Android exposes real outputs (speaker / earpiece / headset / bluetooth) that we can read and
 * select. iOS lets the app choose only between the speaker and the phone's earpiece; Bluetooth
 * and wired devices are chosen in the system route picker.
 */
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Platform } from 'react-native';
import DeviceInfo from 'react-native-device-info';
import { AudioSession } from '@livekit/react-native';

import { errorMessage, logCallAction } from '@/src/services/Call/callActionLog';

import {
  getAppleAudioOutput,
  selectAppleAudioOutput,
  subscribeAppleAudioOutput,
} from '@/src/services/Call/appleAudioOutput';

import {
  guessActiveAudioOutput,
  isAudioOutputType,
  isSpeakerEarpieceOnly,
  type AudioOutputType,
} from '../callStage.utils';

export interface AudioOutputController {
  /** Outputs the app itself can switch between (on iOS: speaker and earpiece). */
  outputs: AudioOutputType[];
  /** Best knowledge of the active route. On iOS it is the built-in choice, even under a headset. */
  active: AudioOutputType | null;
  isLoading: boolean;
  /** iOS picks Bluetooth / AirPlay devices in the system route picker. */
  usesSystemPicker: boolean;
  refresh: () => Promise<AudioOutputType[]>;
  select: (output: AudioOutputType) => Promise<void>;
  /**
   * Primary bar button. Flips speaker ↔ earpiece when those are the only choices and returns
   * `'toggled'`. With a headset or Bluetooth in play the user has to choose: `'needs-picker'`
   * asks the caller to show the in-app list, `'system-picker'` means the iOS picker was opened.
   */
  quickToggle: () => Promise<'toggled' | 'needs-picker' | 'system-picker'>;
  showSystemPicker: () => Promise<void>;
}

const IS_ANDROID = Platform.OS === 'android';
const APPLE_OUTPUTS: AudioOutputType[] = ['speaker', 'earpiece'];

export function useAudioOutput(): AudioOutputController {
  const [outputs, setOutputs] = useState<AudioOutputType[]>(IS_ANDROID ? [] : APPLE_OUTPUTS);
  const [androidActive, setAndroidActive] = useState<AudioOutputType | null>(null);
  const appleActive = useSyncExternalStore(subscribeAppleAudioOutput, getAppleAudioOutput);
  const active = IS_ANDROID ? androidActive : appleActive;
  const [isLoading, setIsLoading] = useState(false);
  const userSelected = useRef(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return (): void => {
      mounted.current = false;
    };
  }, []);

  const refresh = useCallback(async (): Promise<AudioOutputType[]> => {
    if (!IS_ANDROID) return APPLE_OUTPUTS;
    setIsLoading(true);
    try {
      await AudioSession.startAudioSession();
      const raw = await AudioSession.getAudioOutputs();
      const known = raw.filter(isAudioOutputType);
      if (mounted.current) {
        setOutputs(known);
        // Once the user picks a route themselves the OS keeps it, so only guess before that.
        if (!userSelected.current) setAndroidActive(guessActiveAudioOutput(known));
      }
      return known;
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('[useAudioOutput] Failed to fetch audio outputs:', error);
      const fallback: AudioOutputType[] = ['speaker', 'earpiece'];
      if (mounted.current) setOutputs(fallback);
      return fallback;
    } finally {
      if (mounted.current) setIsLoading(false);
    }
  }, []);

  const select = useCallback(async (output: AudioOutputType): Promise<void> => {
    try {
      if (IS_ANDROID) {
        await AudioSession.selectAudioOutput(output);
        userSelected.current = true;
        if (mounted.current) setAndroidActive(output);
      } else if (output === 'speaker' || output === 'earpiece') {
        await selectAppleAudioOutput(output);
      }
      logCallAction('audio_route_selected', { output, outcome: 'ok' });
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('[useAudioOutput] Failed to select audio output:', error);
      logCallAction(
        'audio_route_selected',
        { output, outcome: 'failed', error: errorMessage(error) },
        'error',
      );
    }
  }, []);

  const showSystemPicker = useCallback(async (): Promise<void> => {
    try {
      logCallAction('audio_route_system_picker');
      await AudioSession.showAudioRoutePicker();
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('[useAudioOutput] Failed to show audio route picker:', error);
      logCallAction(
        'audio_route_system_picker',
        { outcome: 'failed', error: errorMessage(error) },
        'error',
      );
    }
  }, []);

  const quickToggle = useCallback(async (): Promise<
    'toggled' | 'needs-picker' | 'system-picker'
  > => {
    if (!IS_ANDROID) {
      // Audio on AirPods or a wired headset: only the system picker can move it off them.
      if (await DeviceInfo.isHeadphonesConnected().catch(() => false)) {
        await showSystemPicker();
        return 'system-picker';
      }
      await select(getAppleAudioOutput() === 'speaker' ? 'earpiece' : 'speaker');
      return 'toggled';
    }
    const available = await refresh();
    if (!isSpeakerEarpieceOnly(available)) return 'needs-picker';
    const current = userSelected.current ? androidActive : guessActiveAudioOutput(available);
    await select(current === 'speaker' ? 'earpiece' : 'speaker');
    return 'toggled';
  }, [androidActive, refresh, select, showSystemPicker]);

  // Learn the starting route (and any headset already plugged in) once the call is up.
  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Stable identity so memoised consumers (control bar, More sheet) only re-render on real changes.
  return useMemo(
    () => ({
      outputs,
      active,
      isLoading,
      usesSystemPicker: !IS_ANDROID,
      refresh,
      select,
      quickToggle,
      showSystemPicker,
    }),
    [outputs, active, isLoading, refresh, select, quickToggle, showSystemPicker],
  );
}
