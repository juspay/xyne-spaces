import { useCallback, useState } from 'react';
import {
  CALL_MEDIA_QUALITY_CONFIG,
  setDetectedMaxCameraHeight,
  type CallMediaQuality,
} from './useCallMediaQualitySettings';

let cachedMaxHeight: number | null | undefined; // undefined = never detected

async function probeMaxCameraHeight(): Promise<number | null> {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) return null;
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: true });
    const [track] = stream.getVideoTracks();
    const maxHeight = track?.getCapabilities?.().height?.max ?? null;
    stream.getTracks().forEach(t => t.stop());
    return maxHeight;
  } catch {
    return null;
  }
}

/**
 * Max camera capture height (px) the device can natively deliver, from
 * `MediaStreamTrack.getCapabilities().height.max`. Detection only runs when
 * `detect()` is called — never automatically — since it briefly activates
 * the camera.
 */
export function useMaxCameraHeight(): {
  maxHeight: number | null;
  isDetecting: boolean;
  detect: () => void;
} {
  const [maxHeight, setMaxHeight] = useState<number | null | undefined>(cachedMaxHeight);
  const [isDetecting, setIsDetecting] = useState(false);

  const detect = useCallback(() => {
    setIsDetecting(true);
    void probeMaxCameraHeight().then(height => {
      cachedMaxHeight = height;
      setDetectedMaxCameraHeight(height);
      setMaxHeight(height);
      setIsDetecting(false);
    });
  }, []);

  return { maxHeight: maxHeight ?? null, isDetecting, detect };
}

export function filterQualityOptionsByMax<T extends { value: CallMediaQuality }>(
  options: T[],
  maxHeight: number | null,
  currentValue: CallMediaQuality,
): T[] {
  if (!maxHeight) return options;
  return options.filter(
    option =>
      CALL_MEDIA_QUALITY_CONFIG[option.value].height <= maxHeight || option.value === currentValue,
  );
}
