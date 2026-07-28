import { isElectronApp } from '../utils/electronApp';

/**
 * Whether this window is painted on a native OS material (macOS vibrancy /
 * Windows 11 Mica) and the real desktop is visible behind it.
 *
 * Tri-state on purpose:
 *   `null`  — not answered yet (Electron only; the main-process round trip is
 *             still in flight). Consumers must NOT paint the wallpaper yet,
 *             otherwise a vibrant window flashes a full-screen photo for a
 *             frame before it is torn back down.
 *   `false` — plain opaque window: web, Linux, Windows 10, "Reduce
 *             transparency", and every pop-out / overlay window.
 *   `true`  — glass. Renderer drops the wallpaper and lets the material show.
 *
 * On the web there is no main process to ask, so this resolves to `false`
 * synchronously at module load and nothing downstream ever changes behaviour.
 */
let glassActive: boolean | null = isElectronApp() ? null : false;

const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) {
    listener();
  }
}

export function getGlassActive(): boolean | null {
  return glassActive;
}

export function setGlassActive(next: boolean): void {
  if (glassActive === next) {
    return;
  }
  glassActive = next;
  emit();
}

export function subscribeGlassActive(listener: () => void): () => void {
  listeners.add(listener);
  return (): void => {
    listeners.delete(listener);
  };
}
