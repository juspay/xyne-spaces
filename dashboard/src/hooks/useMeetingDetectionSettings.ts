import { useCallback, useEffect, useState } from 'react';
import { MEETING_DETECTION_ENABLED_KEY } from '../constants/settings';

export const useMeetingDetectionSettings = () => {
  const [enabled, setEnabled] = useState<boolean>(() => {
    const stored = localStorage.getItem(MEETING_DETECTION_ENABLED_KEY);
    return stored === null ? true : stored === 'true';
  });

  useEffect(() => {
    localStorage.setItem(MEETING_DETECTION_ENABLED_KEY, String(enabled));
    window.electronAPI?.meetingDetector?.setEnabled(enabled);
  }, [enabled]);

  const toggle = useCallback(() => {
    setEnabled(prev => !prev);
  }, []);

  return { meetingDetectionEnabled: enabled, toggleMeetingDetection: toggle };
};
