import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { CallType } from '@xyne/shared';
import { usePlatform } from '../../hooks/usePlatform';
import { focusCallWindow } from '../../utils/electronApp';
import {
  openRingCallWindow,
  readActiveWorkspaceId,
  shouldUseCallWindow,
} from './callWindowLauncher';

interface UseCallWindowRingOptions {
  ringingCallId: string | undefined;
  callType: CallType | undefined;
}

interface CallWindowRing {
  usesCallWindow: boolean;
  ringWindowShown: boolean;
  /** The call the ring window was actually opened for, so callers never focus it blind. */
  ringWindowCallId: string | null;
  focusRingWindow: () => void;
}

export function useCallWindowRing(options: UseCallWindowRingOptions): CallWindowRing {
  const { ringingCallId, callType } = options;
  const { isMobile } = usePlatform();
  const { workspaceId } = useParams<{ workspaceId?: string }>();
  const openedForCallRef = useRef<string | null>(null);
  const [ringWindowShown, setRingWindowShown] = useState(false);
  const [ringWindowCallId, setRingWindowCallId] = useState<string | null>(null);

  const usesCallWindow = shouldUseCallWindow(isMobile);

  useEffect(() => {
    if (!usesCallWindow) return;
    window.electronAPI?.ipcSend?.('call:prewarm-window');
  }, [usesCallWindow]);

  useEffect(() => {
    if (!usesCallWindow) return;
    if (!ringingCallId) {
      openedForCallRef.current = null;
      setRingWindowShown(false);
      setRingWindowCallId(null);
      return;
    }
    if (openedForCallRef.current === ringingCallId) return;

    const opened = openRingCallWindow({
      callId: ringingCallId,
      callType,
      workspaceId: readActiveWorkspaceId(workspaceId),
    });

    // Only mark the call handled once the window actually opened. Marking it up front
    // means a refused open — a live call still holding the window — is never retried,
    // and that incoming call is dropped for good.
    if (opened) openedForCallRef.current = ringingCallId;
    setRingWindowShown(opened);
    setRingWindowCallId(opened ? ringingCallId : null);
  }, [callType, ringingCallId, usesCallWindow, workspaceId]);

  const focusRingWindow = useCallback(() => {
    focusCallWindow();
  }, []);

  return { usesCallWindow, ringWindowShown, ringWindowCallId, focusRingWindow };
}
