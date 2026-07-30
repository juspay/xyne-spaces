import { useCallback, useEffect, useRef, useState } from 'react';
import type { PartialBlock } from '@blocknote/core';
import { useBlocker, type BlockerFunction } from 'react-router-dom';
import { toast } from 'sonner';

import { useCanvasTitleGenerator } from './useCanvasTitleGenerator';
import {
  deriveFallbackCanvasTitle,
  extractCanvasPlainText,
  hasMeaningfulCanvasContent,
  isUntitledCanvasTitle,
} from '../utils/canvasTitleUtils';

interface UseCanvasExitTitleGuardOptions {
  getTitle: () => string;
  getContent: () => PartialBlock[] | undefined;
  enabled?: boolean;
  canEdit: boolean;
  canDelete: boolean;
  onExit: () => void;
  onSaveTitle: (title: string) => void | Promise<void>;
  onDeleteAndExit: () => void | Promise<void>;
}

export function useCanvasExitTitleGuard(options: UseCanvasExitTitleGuardOptions): {
  requestExit: () => void;
  requestExitWith: (continueExit: () => void) => void;
  dialogProps: {
    open: boolean;
    title: string;
    isGenerating: boolean;
    isSaving: boolean;
    isDeleting: boolean;
    generationFailed: boolean;
    canDelete: boolean;
    onTitleChange: (title: string) => void;
    onKeepEditing: () => void;
    onSaveAndExit: () => void;
    onDelete: () => void;
    onRegenerate: () => void;
  };
} {
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const pendingExitRef = useRef<{ continueExit: () => void; alreadyBlocked: boolean } | null>(null);
  const bypassNavigationRef = useRef(false);
  const backgroundGenerationRef = useRef(false);
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const userEditedRef = useRef(false);
  const { isGenerating, error, generate, cancel, reset } = useCanvasTitleGenerator();

  const shouldBlockNavigation = useCallback<BlockerFunction>(
    ({ currentLocation, nextLocation }) =>
      !bypassNavigationRef.current &&
      optionsRef.current.enabled !== false &&
      optionsRef.current.canEdit &&
      isUntitledCanvasTitle(optionsRef.current.getTitle()) &&
      (currentLocation.pathname !== nextLocation.pathname ||
        currentLocation.search !== nextLocation.search ||
        currentLocation.hash !== nextLocation.hash),
    [],
  );
  const blocker = useBlocker(shouldBlockNavigation);

  const runGeneration = useCallback(
    async (plainText: string) => {
      if (!plainText || plainText.length < 20) return;
      const generated = await generate(plainText);
      if (generated && !userEditedRef.current) setTitle(generated);
    },
    [generate],
  );

  const openExitDialog = useCallback(
    (continueExit: () => void, alreadyBlocked = false) => {
      pendingExitRef.current = { continueExit, alreadyBlocked };
      const blocks = optionsRef.current.getContent();
      const plainText = extractCanvasPlainText(blocks);
      userEditedRef.current = false;
      reset();
      setContent(plainText);
      setTitle(deriveFallbackCanvasTitle(blocks));
      setOpen(true);

      if (hasMeaningfulCanvasContent(blocks)) void runGeneration(plainText);
    },
    [reset, runGeneration],
  );

  const generateTitleInBackground = useCallback(async () => {
    if (
      backgroundGenerationRef.current ||
      optionsRef.current.enabled === false ||
      !optionsRef.current.canEdit ||
      !isUntitledCanvasTitle(optionsRef.current.getTitle())
    ) {
      return;
    }

    const blocks = optionsRef.current.getContent();
    if (!hasMeaningfulCanvasContent(blocks)) return;

    backgroundGenerationRef.current = true;
    try {
      const generatedTitle = await generate(extractCanvasPlainText(blocks));
      if (!generatedTitle || !isUntitledCanvasTitle(optionsRef.current.getTitle())) return;
      await optionsRef.current.onSaveTitle(generatedTitle);
    } catch {
      return;
    } finally {
      backgroundGenerationRef.current = false;
    }
  }, [generate]);

  const requestExitWith = useCallback(
    (continueExit: () => void) => {
      const currentTitle = optionsRef.current.getTitle();
      if (
        optionsRef.current.enabled === false ||
        !optionsRef.current.canEdit ||
        !isUntitledCanvasTitle(currentTitle)
      ) {
        continueExit();
        return;
      }

      openExitDialog(continueExit);
    },
    [openExitDialog],
  );

  const requestExit = useCallback(() => {
    requestExitWith(optionsRef.current.onExit);
  }, [requestExitWith]);

  useEffect(() => {
    if (blocker.state !== 'blocked') return;

    if (
      optionsRef.current.enabled === false ||
      !optionsRef.current.canEdit ||
      !isUntitledCanvasTitle(optionsRef.current.getTitle())
    ) {
      blocker.proceed();
      return;
    }

    openExitDialog(blocker.proceed, true);
  }, [blocker, openExitDialog]);

  useEffect(() => {
    const handleVisibilityChange = (): void => {
      if (document.visibilityState === 'hidden') void generateTitleInBackground();
    };

    const handlePageHide = (): void => {
      if (
        optionsRef.current.enabled === false ||
        !optionsRef.current.canEdit ||
        !isUntitledCanvasTitle(optionsRef.current.getTitle())
      ) {
        return;
      }

      const fallbackTitle = deriveFallbackCanvasTitle(optionsRef.current.getContent());
      if (fallbackTitle) {
        void Promise.resolve(optionsRef.current.onSaveTitle(fallbackTitle)).catch(() => undefined);
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('pagehide', handlePageHide);
    return (): void => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('pagehide', handlePageHide);
    };
  }, [generateTitleInBackground]);

  const onKeepEditing = useCallback(() => {
    cancel();
    setOpen(false);
    pendingExitRef.current = null;
    if (blocker.state === 'blocked') blocker.reset();
  }, [blocker, cancel]);

  const continuePendingExit = useCallback(() => {
    const pendingExit = pendingExitRef.current;
    const continueExit = pendingExit?.continueExit ?? optionsRef.current.onExit;
    pendingExitRef.current = null;
    setOpen(false);

    bypassNavigationRef.current = !pendingExit?.alreadyBlocked;
    continueExit();
    window.setTimeout(() => {
      bypassNavigationRef.current = false;
    }, 0);
  }, []);

  const onSaveAndExit = useCallback(() => {
    const normalizedTitle = title.trim();
    if (!normalizedTitle || isSaving || isDeleting) return;

    cancel();
    setIsSaving(true);
    void Promise.resolve()
      .then(() => optionsRef.current.onSaveTitle(normalizedTitle))
      .then(continuePendingExit)
      .catch(() => toast.error('Failed to save the canvas title. Please try again.'))
      .finally(() => setIsSaving(false));
  }, [cancel, continuePendingExit, isDeleting, isSaving, title]);

  const onDelete = useCallback(() => {
    if (isDeleting || isSaving) return;
    cancel();
    setIsDeleting(true);
    void Promise.resolve()
      .then(() => optionsRef.current.onDeleteAndExit())
      .then(continuePendingExit)
      .catch(() => toast.error('Failed to delete the canvas. Please try again.'))
      .finally(() => setIsDeleting(false));
  }, [cancel, continuePendingExit, isDeleting, isSaving]);

  const onRegenerate = useCallback(() => {
    userEditedRef.current = false;
    void runGeneration(content);
  }, [content, runGeneration]);

  useEffect(
    (): (() => void) => () => {
      cancel();
      pendingExitRef.current = null;
    },
    [cancel],
  );

  return {
    requestExit,
    requestExitWith,
    dialogProps: {
      open,
      title,
      isGenerating,
      isSaving,
      isDeleting,
      generationFailed: !!error,
      canDelete: options.canDelete,
      onTitleChange: (nextTitle: string): void => {
        userEditedRef.current = true;
        setTitle(nextTitle);
      },
      onKeepEditing,
      onSaveAndExit,
      onDelete,
      onRegenerate,
    },
  };
}
