import { useCallback, useEffect, useRef, useState } from 'react';
import { setGlassActive } from '../stores/glassModeStore';
import { trackGlassToggled } from '../services/otel/glassMetrics';

/**
 * The Preferences -> Appearance glass toggle.
 *
 * `isSupported` deliberately means "this machine can draw a native material",
 * NOT "the effect is currently on". The two are separate so the control can be
 * hidden outright on the web, on Linux, on Windows 10 and under macOS "Reduce
 * transparency", while still rendering unchecked for someone who simply turned
 * it off. A dead switch would be worse than no switch.
 */
export function useGlassSettings(): {
  enabled: boolean;
  isSupported: boolean;
  setEnabled: (enabled: boolean) => void;
} {
  const api = window.electronAPI?.glass;
  const [isSupported, setIsSupported] = useState(false);
  const [enabled, setEnabledState] = useState(false);
  const tierRef = useRef<string | undefined>(undefined);

  useEffect(() => {
    if (!api) return;
    let cancelled = false;

    void api
      .getSettings()
      .then(settings => {
        if (cancelled) return;
        tierRef.current = settings.tier;
        setIsSupported(settings.supported);
        setEnabledState(settings.enabled);
      })
      .catch(() => {
        // Fail closed: no toggle rather than a switch that does nothing.
        if (!cancelled) setIsSupported(false);
      });

    // Main is the source of truth; keep the switch honest if the effect is
    // turned off from anywhere else.
    const unsubscribe = api.onActiveChanged(active => {
      setEnabledState(active);
      setGlassActive(active);
    });

    return (): void => {
      cancelled = true;
      unsubscribe();
    };
  }, [api]);

  const setEnabled = useCallback(
    (next: boolean) => {
      if (!api) return;

      setEnabledState(next);
      // Flip the shared store BEFORE the IPC. The wallpaper mounts off this
      // store, so doing it first means the opaque wallpaper is already painted
      // when the native material goes away — otherwise there is a gap of a
      // frame or two where the window has no material and no wallpaper either,
      // and the bare desktop shows through.
      setGlassActive(next);
      api.setEnabled(next);
      trackGlassToggled(next, tierRef.current);
    },
    [api],
  );

  return { enabled, isSupported, setEnabled };
}
