import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from 'expo-audio';

import sosAlertSound from '../../../assets/sounds/sos_alert.mp3';

let siren: AudioPlayer | null = null;
let starting: Promise<void> | null = null;
let lifecycleVersion = 0;

export async function startSosSiren(): Promise<void> {
  if (siren || starting) return starting ?? Promise.resolve();

  const startVersion = ++lifecycleVersion;
  const startPromise = (async (): Promise<void> => {
    try {
      await setAudioModeAsync({
        playsInSilentMode: true,
        shouldPlayInBackground: false,
      });

      // The alert may have been acknowledged while audio mode was being set.
      if (startVersion !== lifecycleVersion) return;

      const player = createAudioPlayer(sosAlertSound);
      player.loop = true;
      player.volume = 1;
      player.play();

      if (startVersion !== lifecycleVersion) {
        player.pause();
        player.remove();
        return;
      }
      siren = player;
    } catch {
      // Siren start failed; in-app modal may still be visible.
    }
  })();

  starting = startPromise;
  try {
    await startPromise;
  } finally {
    if (starting === startPromise) {
      starting = null;
    }
  }
}

export async function stopSosSiren(): Promise<void> {
  lifecycleVersion += 1;
  const current = siren;
  siren = null;
  starting = null;
  if (!current) return;

  try {
    current.pause();
    current.remove();
  } catch {
    // Siren stop failed; best-effort cleanup.
  }
}
