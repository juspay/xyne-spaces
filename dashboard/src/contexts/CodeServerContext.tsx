/**
 * CodeServerContext - Global context for code-server status
 * Detects and monitors code-server availability across the app
 */
import React, { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { isElectronApp } from '../utils/electronApp';

interface CodeServerStatus {
  isRunning: boolean;
  isDownloading: boolean;
  port: number | null;
  url: string | null;
  pid: number | null;
  binaryInstalled: boolean;
  error: string | null;
}

interface CodeServerContextType {
  status: CodeServerStatus | null;
  isAvailable: boolean;
  isLoading: boolean;
  refresh: () => Promise<void>;
}

const CodeServerContext = createContext<CodeServerContextType | undefined>(undefined);

interface CodeServerProviderProps {
  children: ReactNode;
}

export const CodeServerProvider: React.FC<CodeServerProviderProps> = ({ children }) => {
  const [status, setStatus] = useState<CodeServerStatus | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const checkStatus = async (): Promise<void> => {
    if (!isElectronApp() || !window.electronAPI?.codeServer) {
      setIsLoading(false);
      return;
    }

    try {
      const currentStatus = await window.electronAPI.codeServer.getStatus();
      setStatus(currentStatus);
    } catch (error) {
      // Log error to console for debugging
      console.error('[CodeServerContext] Failed to get status:', error);
      setStatus(null);
    } finally {
      setIsLoading(false);
    }
  };

  // Initial status check
  useEffect(() => {
    void checkStatus();

    // Poll for status updates every 5 seconds
    const interval = setInterval((): void => {
      void checkStatus();
    }, 5000);

    return (): void => clearInterval(interval);
  }, []);

  const refresh = async (): Promise<void> => {
    setIsLoading(true);
    await checkStatus();
  };

  const isAvailable = status?.isRunning === true && status?.url !== null;

  const value: CodeServerContextType = {
    status,
    isAvailable,
    isLoading,
    refresh,
  };

  return <CodeServerContext.Provider value={value}>{children}</CodeServerContext.Provider>;
};

export const useCodeServer = (): CodeServerContextType => {
  const context = useContext(CodeServerContext);
  if (context === undefined) {
    throw new Error('useCodeServer must be used within a CodeServerProvider');
  }
  return context;
};
