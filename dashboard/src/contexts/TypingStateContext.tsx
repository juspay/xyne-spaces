import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';

interface TypingStateContextType {
  hasTyped: boolean;
  notifyTyping: () => void;
  resetTypingState: () => void;
}

const TypingStateContext = createContext<TypingStateContextType | undefined>(undefined);

export const TypingStateProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [hasTyped, setHasTyped] = useState(false);

  const notifyTyping = useCallback(() => {
    setHasTyped(true);
  }, []);

  const resetTypingState = useCallback(() => {
    setHasTyped(false);
  }, []);

  // Listen for mouse movement to reset the typing state
  useEffect(() => {
    const handleMouseMove = () => {
      if (hasTyped) {
        resetTypingState();
      }
    };

    document.addEventListener('mousemove', handleMouseMove);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
    };
  }, [hasTyped, resetTypingState]);

  return (
    <TypingStateContext.Provider value={{ hasTyped, notifyTyping, resetTypingState }}>
      {children}
    </TypingStateContext.Provider>
  );
};

export const useTypingState = (): TypingStateContextType => {
  const context = useContext(TypingStateContext);

  // Return a default implementation if context is not available
  // This allows components to work even when not wrapped in TypingStateProvider
  if (context === undefined) {
    return {
      hasTyped: false,
      notifyTyping: () => {},
      resetTypingState: () => {},
    };
  }

  return context;
};
