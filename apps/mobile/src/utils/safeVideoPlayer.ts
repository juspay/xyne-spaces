import type { VideoPlayer } from 'expo-video';

/** Pause without throwing when the native player shared object is already released. */
export function safePause(player: VideoPlayer): void {
  try {
    player.pause();
  } catch {
    // expo-video releases the shared object when VideoView unmounts
  }
}

/** Play without throwing when the native player shared object is already released. */
export function safePlay(player: VideoPlayer): void {
  try {
    player.play();
  } catch {
    // expo-video releases the shared object when VideoView unmounts
  }
}
