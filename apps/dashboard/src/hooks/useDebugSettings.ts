import { useCallback, useEffect, useState } from 'react';

const DEBUG_STORAGE_KEY = 'xyne-debug-settings';

export interface DebugSettings {
  showSendIndicators: boolean;
  showEmailIdCopyButton: boolean;
  showTicketIdCopyButton: boolean;
}

const DEFAULT_DEBUG_SETTINGS: DebugSettings = {
  showSendIndicators: true,
  showEmailIdCopyButton: false,
  showTicketIdCopyButton: false,
};

export const useDebugSettings = () => {
  const [settings, setSettings] = useState<DebugSettings>(() => {
    const storedSettings = localStorage.getItem(DEBUG_STORAGE_KEY);
    if (storedSettings) {
      try {
        return {
          ...DEFAULT_DEBUG_SETTINGS,
          ...(JSON.parse(storedSettings) as Partial<DebugSettings>),
        };
      } catch {
        return DEFAULT_DEBUG_SETTINGS;
      }
    }
    return DEFAULT_DEBUG_SETTINGS;
  });

  useEffect(() => {
    localStorage.setItem(DEBUG_STORAGE_KEY, JSON.stringify(settings));
  }, [settings]);

  const toggleSendIndicators = useCallback(() => {
    setSettings(prev => ({
      ...prev,
      showSendIndicators: !prev.showSendIndicators,
    }));
  }, []);

  const toggleEmailIdCopyButton = useCallback(() => {
    setSettings(prev => ({
      ...prev,
      showEmailIdCopyButton: !prev.showEmailIdCopyButton,
    }));
  }, []);

  const toggleTicketIdCopyButton = useCallback(() => {
    setSettings(prev => ({
      ...prev,
      showTicketIdCopyButton: !prev.showTicketIdCopyButton,
    }));
  }, []);

  return { settings, toggleSendIndicators, toggleEmailIdCopyButton, toggleTicketIdCopyButton };
};
