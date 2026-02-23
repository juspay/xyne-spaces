import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { usePlatform } from '../hooks/usePlatform';
import { reactNativeBridge, NativeInboundMessageType } from '../utils/reactNativeBridge';

interface KeyboardContextValue {
  isKeyboardOpen: boolean;
}

const KeyboardContext = createContext<KeyboardContextValue | undefined>(undefined);

interface KeyboardProviderProps {
  children: ReactNode;
}

export const KeyboardProvider: React.FC<KeyboardProviderProps> = ({ children }) => {
  const [isKeyboardOpen, setIsKeyboardOpen] = useState(false);
  const { isMobile } = usePlatform();

  useEffect(() => {
    if (!isMobile || !reactNativeBridge.isAvailable()) {
      return undefined;
    }

    const unsubscribeShow = reactNativeBridge.on(NativeInboundMessageType.KEYBOARD_OPEN, () => {
      setIsKeyboardOpen(true);
    });

    const unsubscribeHide = reactNativeBridge.on(NativeInboundMessageType.KEYBOARD_HIDDEN, () => {
      setIsKeyboardOpen(false);
    });

    return () => {
      unsubscribeShow();
      unsubscribeHide();
    };
  }, [isMobile]);

  return <KeyboardContext.Provider value={{ isKeyboardOpen }}>{children}</KeyboardContext.Provider>;
};

export const useKeyboard = (): KeyboardContextValue => {
  const context = useContext(KeyboardContext);
  if (context === undefined) {
    throw new Error('useKeyboard must be used within a KeyboardProvider');
  }
  return context;
};
