import { ReactElement, useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useSelector } from '@xstate/react';
import { RefreshCw, X } from 'lucide-react';
import { callActor } from '../../machines/callMachine';
import { roomActor } from '../../machines/roomMachine';
import { Button } from '../ui/Button/Button';

// Kill switch for the Electron auto-update nudge. While false the component is
// fully inert: no event listener is registered and nothing is rendered.
// Flip to true to re-enable the feature (dashboard-only change, no Electron release needed).
const ELECTRON_UPDATE_NUDGE_ENABLED = false;

const NUDGE_STORAGE_KEY = 'xyne:electron-update-nudge';
const UPDATE_ATTEMPT_STORAGE_KEY = 'xyne:electron-update-attempt';
const UPDATE_RESULT_STORAGE_KEY = 'xyne:electron-update-result';
const VERSION_CHECKS_BEFORE_AUTO_UPDATE = 5;
const AUTO_UPDATE_DELAY_MS = 60_000;
const TYPING_IDLE_MS = 3_000;
const UPDATE_NUDGE_SLOT_SELECTOR = '[data-electron-update-nudge-slot]';

interface UpdateAvailableInfo {
  currentVersion: string;
  latestVersion: string;
  loadType: 'manual' | 'auto';
}

interface PersistedNudgeState {
  currentVersion: string;
  latestVersion: string;
  checkCount: number;
  autoApprovalRequired: boolean;
  countdownEndsAt: number | null;
}

interface UpdateAttempt {
  currentVersion: string;
  latestVersion: string;
  startedAt: string;
  mode: 'manual' | 'automatic';
}

function readStorage<T>(key: string): T | null {
  try {
    const value = window.localStorage.getItem(key);
    return value ? (JSON.parse(value) as T) : null;
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: unknown): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // The update flow still works when storage is unavailable; only persistence is lost.
  }
}

function removeStorage(key: string): void {
  try {
    window.localStorage.removeItem(key);
  } catch {
    // Ignore unavailable storage.
  }
}

function readNudgeState(): PersistedNudgeState | null {
  const value = readStorage<
    Partial<PersistedNudgeState> & {
      dismissCount?: number;
      nextPromptAt?: number | null;
      autoRetryBlocked?: boolean;
    }
  >(NUDGE_STORAGE_KEY);
  if (typeof value?.currentVersion !== 'string' || typeof value.latestVersion !== 'string') {
    return null;
  }
  const restartAfterLegacyFailure = value.autoRetryBlocked === true;
  const storedCount =
    typeof value.checkCount === 'number'
      ? value.checkCount
      : typeof value.dismissCount === 'number'
        ? value.dismissCount
        : 1;
  const checkCount = restartAfterLegacyFailure
    ? 1
    : Math.min(VERSION_CHECKS_BEFORE_AUTO_UPDATE, Math.max(1, storedCount));
  return {
    currentVersion: value.currentVersion,
    latestVersion: value.latestVersion,
    checkCount,
    autoApprovalRequired: restartAfterLegacyFailure
      ? false
      : value.autoApprovalRequired === true || checkCount >= VERSION_CHECKS_BEFORE_AUTO_UPDATE,
    countdownEndsAt:
      !restartAfterLegacyFailure && typeof value.countdownEndsAt === 'number'
        ? value.countdownEndsAt
        : null,
  };
}

function isTextEntryTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  const editable = target.closest(
    'textarea, [contenteditable="true"], [role="textbox"], input:not([type]), input[type="text"], input[type="search"], input[type="email"], input[type="url"], input[type="tel"], input[type="password"], input[type="number"]',
  );
  if (!editable) return false;
  return !editable.hasAttribute('disabled') && !editable.hasAttribute('readonly');
}

function isTypingKey(event: KeyboardEvent): boolean {
  return event.key.length === 1 || ['Backspace', 'Delete', 'Enter'].includes(event.key);
}

function useRecentTyping(): { isTyping: boolean; isTypingNow: () => boolean } {
  const [isTyping, setIsTyping] = useState(false);
  const isTypingRef = useRef(false);
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const markIdle = (): void => {
      isTypingRef.current = false;
      setIsTyping(false);
    };
    const markTyping = (): void => {
      isTypingRef.current = true;
      setIsTyping(true);
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
      idleTimerRef.current = setTimeout(markIdle, TYPING_IDLE_MS);
    };

    const handleInput = (event: Event): void => {
      if (isTextEntryTarget(event.target)) markTyping();
    };
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (isTextEntryTarget(event.target) && isTypingKey(event)) markTyping();
    };
    const handleCompositionStart = (event: CompositionEvent): void => {
      if (isTextEntryTarget(event.target)) {
        isTypingRef.current = true;
        setIsTyping(true);
        if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
      }
    };
    const handleCompositionEnd = (event: CompositionEvent): void => {
      if (isTextEntryTarget(event.target)) markTyping();
    };

    document.addEventListener('input', handleInput, true);
    document.addEventListener('keydown', handleKeyDown, true);
    document.addEventListener('compositionstart', handleCompositionStart, true);
    document.addEventListener('compositionend', handleCompositionEnd, true);

    return (): void => {
      document.removeEventListener('input', handleInput, true);
      document.removeEventListener('keydown', handleKeyDown, true);
      document.removeEventListener('compositionstart', handleCompositionStart, true);
      document.removeEventListener('compositionend', handleCompositionEnd, true);
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
      isTypingRef.current = false;
    };
  }, []);

  const isTypingNow = useCallback((): boolean => isTypingRef.current, []);
  return { isTyping, isTypingNow };
}

function isCallBlockingNow(): boolean {
  const callState = callActor.getSnapshot();
  const roomState = roomActor.getSnapshot();
  return (
    callState.matches('ringing') ||
    callState.matches('accepting') ||
    callState.matches('switching') ||
    roomState.matches('initiating') ||
    roomState.matches('joining') ||
    roomState.matches('connecting') ||
    roomState.matches('connected') ||
    roomState.matches('disconnecting')
  );
}

export const ElectronUpdateNudge = (): ReactElement | null => {
  const [nudge, setNudge] = useState<PersistedNudgeState | null>(null);
  const [visible, setVisible] = useState(false);
  const [remainingSeconds, setRemainingSeconds] = useState(60);
  const [updateNudgeSlot, setUpdateNudgeSlot] = useState<HTMLElement | null>(null);
  const applyingRef = useRef(false);
  const { isTyping, isTypingNow } = useRecentTyping();
  const roomState = useSelector(roomActor, state => state);
  const callState = useSelector(callActor, state => state);
  const callBlocking =
    callState.matches('ringing') ||
    callState.matches('accepting') ||
    callState.matches('switching') ||
    roomState.matches('initiating') ||
    roomState.matches('joining') ||
    roomState.matches('connecting') ||
    roomState.matches('connected') ||
    roomState.matches('disconnecting');
  const activationBlocked = callBlocking || isTyping || !updateNudgeSlot;

  useEffect(() => {
    const findVisibleSlot = (): HTMLElement | null => {
      const slots = Array.from(document.querySelectorAll<HTMLElement>(UPDATE_NUDGE_SLOT_SELECTOR));
      return (
        slots.find(slot => {
          const style = window.getComputedStyle(slot);
          return (
            style.display !== 'none' &&
            style.visibility !== 'hidden' &&
            slot.getClientRects().length > 0
          );
        }) ?? null
      );
    };

    const syncSlot = (): void => setUpdateNudgeSlot(findVisibleSlot());
    syncSlot();

    const observer = new MutationObserver(syncSlot);
    observer.observe(document.body, { childList: true, subtree: true });
    window.addEventListener('resize', syncSlot);

    return (): void => {
      observer.disconnect();
      window.removeEventListener('resize', syncSlot);
    };
  }, []);

  useEffect(() => {
    if (!ELECTRON_UPDATE_NUDGE_ENABLED) return undefined;
    const electronAPI = window.electronAPI;
    if (!electronAPI?.onAppUpdateAvailable) return undefined;

    const attempt = readStorage<UpdateAttempt>(UPDATE_ATTEMPT_STORAGE_KEY);
    let saved = readNudgeState();
    if (attempt) {
      const succeeded = __APP_VERSION__ !== attempt.currentVersion;
      writeStorage(UPDATE_RESULT_STORAGE_KEY, {
        ...attempt,
        loadedVersion: __APP_VERSION__,
        status: succeeded ? 'success' : 'failed',
        completedAt: new Date().toISOString(),
      });
      removeStorage(UPDATE_ATTEMPT_STORAGE_KEY);

      if (succeeded) {
        removeStorage(NUDGE_STORAGE_KEY);
        saved = null;
      } else if (saved?.latestVersion === attempt.latestVersion) {
        saved = {
          ...saved,
          checkCount: 1,
          autoApprovalRequired: false,
          countdownEndsAt: null,
        };
        writeStorage(NUDGE_STORAGE_KEY, saved);
      }
    }

    if (saved) {
      if (saved.currentVersion === __APP_VERSION__ && saved.latestVersion !== __APP_VERSION__) {
        // App hasn't been updated since the nudge was saved — still needs the update.
        // A fresh app/renderer start always gives an automatic update a new full warning period.
        saved = { ...saved, countdownEndsAt: null };
        writeStorage(NUDGE_STORAGE_KEY, saved);
        setNudge(saved);
        setVisible(true);
      } else {
        // App was already updated (or versions match) — nudge is stale, clear it.
        removeStorage(NUDGE_STORAGE_KEY);
        saved = null;
      }
    }

    return electronAPI.onAppUpdateAvailable((data: UpdateAvailableInfo) => {
      if (
        !data ||
        typeof data.currentVersion !== 'string' ||
        typeof data.latestVersion !== 'string' ||
        data.currentVersion === data.latestVersion
      ) {
        return;
      }

      const previous = readNudgeState();
      const isSameUpdate = previous?.latestVersion === data.latestVersion;
      const checkCount = isSameUpdate
        ? Math.min(VERSION_CHECKS_BEFORE_AUTO_UPDATE, previous.checkCount + 1)
        : 1;
      const autoApprovalRequired = checkCount >= VERSION_CHECKS_BEFORE_AUTO_UPDATE;
      const next: PersistedNudgeState = isSameUpdate
        ? {
            ...previous,
            currentVersion: data.currentVersion,
            checkCount,
            autoApprovalRequired,
            countdownEndsAt: autoApprovalRequired ? previous.countdownEndsAt : null,
          }
        : {
            currentVersion: data.currentVersion,
            latestVersion: data.latestVersion,
            checkCount,
            autoApprovalRequired,
            countdownEndsAt: null,
          };
      writeStorage(NUDGE_STORAGE_KEY, next);
      setNudge(next);
      setVisible(true);
    });
  }, []);

  useEffect(() => {
    if (nudge) writeStorage(NUDGE_STORAGE_KEY, nudge);
  }, [nudge]);

  useEffect(() => {
    if (!nudge?.autoApprovalRequired) return;

    if (activationBlocked) {
      if (nudge.countdownEndsAt !== null) {
        setNudge(current => (current ? { ...current, countdownEndsAt: null } : current));
        setRemainingSeconds(60);
      }
      return;
    }

    if (nudge.countdownEndsAt === null) {
      const countdownEndsAt = Date.now() + AUTO_UPDATE_DELAY_MS;
      setNudge(current => (current ? { ...current, countdownEndsAt } : current));
    }
  }, [activationBlocked, callBlocking, isTyping, nudge]);

  const applyUpdate = useCallback(
    (mode: 'manual' | 'automatic'): void => {
      if (
        !nudge ||
        activationBlocked ||
        isTypingNow() ||
        isCallBlockingNow() ||
        applyingRef.current
      ) {
        return;
      }
      applyingRef.current = true;
      const attempt: UpdateAttempt = {
        currentVersion: nudge.currentVersion,
        latestVersion: nudge.latestVersion,
        startedAt: new Date().toISOString(),
        mode,
      };
      writeStorage(UPDATE_ATTEMPT_STORAGE_KEY, attempt);
      window.electronAPI?.applyAppUpdate();
    },
    [activationBlocked, isTypingNow, nudge],
  );

  useEffect(() => {
    if (!nudge?.countdownEndsAt || activationBlocked) return undefined;

    const updateRemainingTime = (): void => {
      const remaining = Math.max(0, nudge.countdownEndsAt! - Date.now());
      setRemainingSeconds(Math.ceil(remaining / 1000));
      if (remaining === 0) applyUpdate('automatic');
    };
    updateRemainingTime();
    const interval = window.setInterval(updateRemainingTime, 250);
    return (): void => window.clearInterval(interval);
  }, [activationBlocked, applyUpdate, nudge?.countdownEndsAt]);

  const dismissUpdate = (): void => {
    if (!nudge || nudge.autoApprovalRequired) return;
    setVisible(false);
  };

  if (!ELECTRON_UPDATE_NUDGE_ENABLED) return null;
  if (!window.electronAPI || !nudge || !visible || !updateNudgeSlot) return null;

  const title =
    nudge.autoApprovalRequired && !activationBlocked
      ? `Updating in ${remainingSeconds}s`
      : nudge.autoApprovalRequired
        ? 'Update waiting'
        : 'Update available';
  const message = !nudge.autoApprovalRequired
    ? `Version ${nudge.latestVersion} is ready. Reminder ${nudge.checkCount} of ${VERSION_CHECKS_BEFORE_AUTO_UPDATE}.`
    : callBlocking
      ? 'The update will begin after your call ends.'
      : isTyping
        ? 'The update will begin after you stop typing.'
        : 'The app will refresh automatically. You can update immediately instead.';

  return createPortal(
    <section
      role='status'
      aria-live='polite'
      className='m-1 mb-0 flex min-h-10 items-center gap-2 rounded-xl bg-muted px-3 py-2'
      data-testid='electron-update-nudge'
    >
      <RefreshCw className='h-3.5 w-3.5 shrink-0 text-primary' />
      <div className='flex min-w-0 flex-1 items-baseline gap-1.5'>
        <p className='shrink-0 text-xs font-semibold text-foreground'>{title}</p>
        <p className='truncate text-xs text-muted-foreground'>{message}</p>
      </div>
      <Button
        type='button'
        variant='ghost'
        onClick={() => applyUpdate('manual')}
        disabled={activationBlocked}
        className='h-auto shrink-0 rounded-md bg-primary px-2.5 py-1.5 text-xs font-semibold text-primary-foreground hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50'
        trackId='electron_apply_update'
        data-track-category='ElectronUpdate'
        data-track-name='UpdateNow'
      >
        Update now
      </Button>
      {!nudge.autoApprovalRequired && (
        <button
          type='button'
          onClick={dismissUpdate}
          className='shrink-0 rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground'
          aria-label='Dismiss update'
          data-track-category='ElectronUpdate'
          data-track-name='DismissUpdate'
        >
          <X className='h-3.5 w-3.5' />
        </button>
      )}
    </section>,
    updateNudgeSlot,
  );
};
