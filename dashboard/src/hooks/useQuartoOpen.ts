import { useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { isElectronApp } from '../utils/electronApp';
import { useVSCode } from '../contexts/VSCodeContext';
import { apiInstance } from '../services/clients/apiClient';
import { logger, Event } from '../utils/logger';

interface UseQuartoOpenReturn {
  openQuartoDoc: () => Promise<void>;
  isLoading: boolean;
  error: string | null;
}

export const useQuartoOpen = (): UseQuartoOpenReturn => {
  const navigate = useNavigate();
  const { registerSession } = useVSCode();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const openQuartoDoc = useCallback(async () => {
    if (!isElectronApp()) {
      toast.info('Create Quarto Doc', {
        description: 'Quarto doc creation is only available in the Electron app.',
      });
      return;
    }

    const api = window.electronAPI?.codeServer;
    if (!api?.prepareForTicket) {
      toast.error('Error', {
        description: 'Please restart the Electron app to enable this feature',
      });
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const loadingToastId = toast.loading('Setting up Quarto workspace...', {
        description: 'Opening xyne-spaces-docs repository',
      });
      logger.info(Event.QUARTO_SETUP_STARTED, { docType: 'public' });

      const setupResponse = await apiInstance.post<{
        success: boolean;
        repoUrl: string;
        branch: string;
        error?: string;
      }>('/docs/setup-quarto-access');

      if (!setupResponse.data.success) {
        logger.error(Event.QUARTO_ACCESS_SETUP_FAILED, { error: setupResponse.data.error });
        toast.dismiss(loadingToastId);
        toast.error('Setup failed', {
          description: setupResponse.data.error ?? 'Failed to setup repository access',
        });
        setError(setupResponse.data.error ?? 'Failed to setup repository access');
        setIsLoading(false);
        return;
      }
      logger.info(Event.QUARTO_ACCESS_SETUP_SUCCESS, {
        repoUrl: setupResponse.data.repoUrl,
        branch: setupResponse.data.branch,
      });

      const { repoUrl, branch } = setupResponse.data;

      const result = await api.prepareForTicket(repoUrl, branch, branch);

      if (!result.success) {
        logger.error(Event.QUARTO_SETUP_FAILED, { error: result.error, repoUrl, branch });
        toast.dismiss(loadingToastId);
        toast.error('Failed to prepare workspace', {
          description: result.error ?? 'Unknown error',
        });
        setError(result.error ?? 'Failed to prepare workspace');
        setIsLoading(false);
        return;
      }

      if (result.stashedChanges) {
        toast.warning('Uncommitted changes were stashed', {
          description: 'Use "git stash pop" to restore them',
          duration: 5000,
        });
      }

      const codeServerUrl = await api.getUrlWithFolder(result.workspacePath);
      if (!codeServerUrl) {
        logger.error(Event.QUARTO_SETUP_FAILED, {
          error: 'Failed to get VS Code URL',
          repoUrl,
          branch,
        });
        toast.dismiss(loadingToastId);
        toast.error('Failed to get VS Code URL');
        setError('Failed to get VS Code URL');
        setIsLoading(false);
        return;
      }

      registerSession(result.workspacePath, codeServerUrl, branch, 'xyne-spaces-docs', undefined);

      logger.info(Event.QUARTO_WORKSPACE_READY, {
        repoUrl,
        branch,
        workspacePath: result.workspacePath,
      });
      toast.dismiss(loadingToastId);
      toast.success(`Quarto workspace ready on branch ${branch}`);

      void navigate('/vscode');
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to setup quarto access';
      logger.error(Event.QUARTO_SETUP_FAILED, { error: errorMessage });
      toast.error('Error', {
        description: errorMessage,
      });
      setError(errorMessage);
    } finally {
      setIsLoading(false);
    }
  }, [navigate, registerSession]);

  return { openQuartoDoc, isLoading, error };
};
