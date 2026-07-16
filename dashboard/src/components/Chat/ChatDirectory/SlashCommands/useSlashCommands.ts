import { useState, useRef, useMemo, useCallback, useEffect } from 'react';
import { ChannelScopeType } from '@xyne/shared';
import type { User, Channel } from '@xyne/shared';
import { parseSearchCommand, SEARCH_COMMANDS, type SearchCommandKind } from './commands';
import { useQuickCall } from '../../../../hooks/useQuickCall';
import { useActiveUserSearch } from '../../../../hooks/useUsers';
import { useChannelSearch, useAllVisibleChannels } from '../../../../hooks/useChannels';
import { CMDK_USER_LIMIT } from '../../../../hooks/useSearchMetrics';
import { xyneAIActor } from '../../../../machines/xyneAIMachine';
import { getUserDisplayName } from '../../../../utils/userDisplayName';
import type { CommandTarget } from './QuickDmComposer';

interface UseSlashCommandsParams {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentUserID: string;
  /** Highlighted cmdk row label + whether the user has navigated — feed the ghost text. */
  activeItemLabel: string | null;
  hasNavigated: boolean;
  /** Clears stale Vespa search state on the transition into command mode. */
  resetSearchState: () => void;
  /** Navigate to an app route (used by `/record`). */
  navigate: (path: string) => void;
}

interface CommandGhost {
  suffix: string;
  word: string;
  canComplete: boolean;
}

interface UseSlashCommandsReturn {
  commandActive: boolean;
  commandKind: SearchCommandKind | null;
  commandText: string;
  commandTarget: CommandTarget | null;
  isComposing: boolean;
  pendingChannelCall: { id: string; name: string } | null;
  commandUserResults: User[];
  commandChannelResults: Channel[];
  commandGhost: CommandGhost;
  setActiveCommandWord: (word: string | null) => void;
  setPendingChannelCall: (value: { id: string; name: string } | null) => void;
  resetCommand: () => void;
  exitCommandMode: () => void;
  clearTarget: () => void;
  applyCommand: (word: string) => void;
  openAskAI: () => void;
  openRecordings: () => void;
  runCommandTarget: (target: CommandTarget) => void;
  startChannelCall: (channelId: string, displayName: string) => void;
  isInCommandMode: () => boolean;
  onSetTextReady: (setText: (text: string) => void) => void;
  /** Consume `/`-prefixed editor text; returns true when it is a command (parent returns early). */
  handleEditorText: (text: string) => boolean;
}

/**
 * Owns all `/call`/`/chat`/`/askai` slash-command state and logic for the Cmd+K search box.
 * Extracted from ChannelCommandMenu; the parent keeps only the thin wiring — it feeds the shared
 * cmdk selection state (`activeItemLabel`/`hasNavigated`) in, folds `commandGhost` into the ghost
 * suffix, guards the mention triggers with `isInCommandMode`, and renders `SlashCommandPalette`.
 */
export function useSlashCommands({
  open,
  onOpenChange,
  currentUserID,
  activeItemLabel,
  hasNavigated,
  resetSearchState,
  navigate,
}: UseSlashCommandsParams): UseSlashCommandsReturn {
  // Raw command text is kept here (NOT fed to the search hook) so Vespa is never queried while a
  // command is active. Once a target is picked, `commandTarget` holds it (a user OR a channel) and
  // drives the composer / call-confirm; the search field keeps its hidden `/<cmd> <query>` text.
  const [commandText, setCommandText] = useState('');
  const [commandTarget, setCommandTarget] = useState<CommandTarget | null>(null);
  const commandTargetRef = useRef<CommandTarget | null>(null);
  // Synchronous mirror of the command text — lets the mention-trigger guards know a command is
  // active without waiting for a state re-render.
  const commandTextRef = useRef('');
  // Which command row is highlighted (hover/arrow) in the `/` list — drives which command's format
  // the ghost text previews. Null → the first matching command.
  const [activeCommandWord, setActiveCommandWord] = useState<string | null>(null);
  // Imperative "replace the whole editor with plain text" (wired via `onSetTextReady`).
  const setTextRef = useRef<((text: string) => void) | null>(null);
  const { startCall, startChannelCall, hasActiveChannelCall, ensureRoomIdle } = useQuickCall();
  // A `/call` on a channel closes Cmd+K and shows the shared call-confirmation modal. That modal is
  // z-50 and would sit behind the z-[9999] Cmd+K dialog, so we close first; this state is
  // independent of the command lifecycle so it survives that close.
  const [pendingChannelCall, setPendingChannelCall] = useState<{ id: string; name: string } | null>(
    null,
  );

  // True while a command is active (picker, discovery, compose, or call-confirm). Read from refs so
  // it's correct synchronously inside the mention guards.
  const isInCommandMode = useCallback(
    () => commandTargetRef.current !== null || commandTextRef.current.startsWith('/'),
    [],
  );

  const parsedCommand = useMemo(() => parseSearchCommand(commandText), [commandText]);
  const commandActive = commandText.startsWith('/') || commandTarget !== null;
  // `commandText` keeps its `/call `/`/chat ` prefix even after a target is picked, so the kind is
  // always parseable — no need to infer it from the target.
  const commandKind: SearchCommandKind | null = parsedCommand?.kind ?? null;
  // A picked target for `/chat` opens the composer; a channel picked for `/call` opens the confirm
  // modal. A user for `/call` fires instantly and never sets a target.
  const isComposing = commandTarget !== null && commandKind === 'chat';
  // Only `/call`/`/chat` have a target picker; `/askai` takes no argument.
  const isPickerCommand = commandKind === 'call' || commandKind === 'chat';
  // Picker filter (before a target is set). A leading `@`/`#` scopes the picker to people/channels
  // respectively (matching cmdk's general convention); the remainder is the query.
  const commandArg = commandTarget ? '' : (parsedCommand?.arg ?? '');
  const commandScope: 'user' | 'channel' | null = !isPickerCommand
    ? null
    : commandArg[0] === '@'
      ? 'user'
      : commandArg[0] === '#'
        ? 'channel'
        : null;
  const commandQuery = isPickerCommand ? (commandScope ? commandArg.slice(1) : commandArg) : '';
  const showUserResults = commandScope !== 'channel';
  const showChannelResults = commandScope !== 'user';

  const commandUsers = useActiveUserSearch(commandQuery, CMDK_USER_LIMIT);
  const commandUserResults = useMemo(
    () => (showUserResults ? commandUsers.filter(u => u.id !== currentUserID) : []),
    [showUserResults, commandUsers, currentUserID],
  );
  // Channel picker candidates: real group channels (DEFAULT scope) the user can access.
  const commandChannels = useChannelSearch(commandQuery, CMDK_USER_LIMIT);
  const visibleChannels = useAllVisibleChannels();
  const commandChannelResults = useMemo(() => {
    if (!showChannelResults) return [];
    const visibleIds = new Set(visibleChannels.map(c => c.id));
    return commandChannels.filter(
      c => c.scopeType === ChannelScopeType.DEFAULT && visibleIds.has(c.id),
    );
  }, [showChannelResults, commandChannels, visibleChannels]);

  useEffect(() => {
    commandTargetRef.current = commandTarget;
  }, [commandTarget]);

  const resetCommand = useCallback((): void => {
    commandTargetRef.current = null;
    commandTextRef.current = '';
    setCommandTarget(null);
    setCommandText('');
    setActiveCommandWord(null);
  }, []);

  const exitCommandMode = useCallback((): void => {
    resetCommand();
    setTextRef.current?.('');
  }, [resetCommand]);

  // Target picked → set it (opens the composer for `/chat`, or the call-confirm modal for a `/call`
  // channel). The search field keeps its hidden `/<cmd> <query>` text so "back" restores the picker.
  const selectTarget = useCallback((target: CommandTarget): void => {
    commandTargetRef.current = target;
    setCommandTarget(target);
  }, []);

  // Back from the composer / confirm → drop the target, showing the picker again.
  const clearTarget = useCallback((): void => {
    commandTargetRef.current = null;
    setCommandTarget(null);
  }, []);

  // Seed the editor with `/call `/`/chat ` when a command is picked from the `/` list.
  const applyCommand = useCallback((word: string): void => {
    const text = `/${word} `;
    // Mirror the command text into the ref/state synchronously so isInCommandMode() is correct
    // before Lexical's onChange fires — otherwise the mention-trigger guards briefly treat the
    // input as a normal search.
    commandTextRef.current = text;
    setCommandText(text);
    setTextRef.current?.(text);
  }, []);

  // `/askai` takes no target — it just opens the global Xyne AI panel and closes Cmd+K.
  const openAskAI = useCallback((): void => {
    xyneAIActor.send({ type: 'OPEN' });
    exitCommandMode();
    onOpenChange(false);
  }, [exitCommandMode, onOpenChange]);

  // `/record` takes no target — it navigates to the Recordings page and closes Cmd+K.
  const openRecordings = useCallback((): void => {
    navigate('/recordings');
    exitCommandMode();
    onOpenChange(false);
  }, [navigate, exitCommandMode, onOpenChange]);

  const runCommandTarget = useCallback(
    (target: CommandTarget): void => {
      if (commandKind === 'call') {
        if (target.type === 'user') {
          // A 1:1 call fires instantly, matching the rest of the app.
          startCall(target.user.id, getUserDisplayName(target.user));
        } else if (hasActiveChannelCall(target.channel.id)) {
          // A call is already live on the channel — join it directly, no "start a call?" confirm
          // (you're joining an existing call, not starting a new channel-wide one).
          startChannelCall(target.channel.id, target.channel.name);
        } else if (ensureRoomIdle()) {
          // No call yet — confirm before starting a new channel-wide call. The modal renders as a
          // sibling of the Cmd+K dialog, so closing Cmd+K here doesn't tear it down.
          setPendingChannelCall({ id: target.channel.id, name: target.channel.name });
        }
        exitCommandMode();
        onOpenChange(false);
        return;
      }
      // `/chat`: open the composer for the picked user/channel.
      selectTarget(target);
    },
    [
      commandKind,
      startCall,
      startChannelCall,
      hasActiveChannelCall,
      ensureRoomIdle,
      exitCommandMode,
      onOpenChange,
      selectTarget,
    ],
  );

  // Clear command state whenever the menu closes.
  useEffect(() => {
    if (!open) resetCommand();
  }, [open, resetCommand]);

  const commandGhost = useMemo((): CommandGhost => {
    if (commandTarget || !commandText.startsWith('/')) {
      return { suffix: '', word: '', canComplete: false };
    }
    if (!parsedCommand) {
      // Still typing the word (`/`, `/c`, `/ch`…) — complete the highlighted command's word (falls
      // back to the first match). The argument prompt comes once the word is complete (below).
      const typedWord = commandText.slice(1).toLowerCase();
      const matches = SEARCH_COMMANDS.filter(c => c.word.startsWith(typedWord));
      const def = matches.find(c => c.word === activeCommandWord) ?? matches[0];
      if (def) {
        return { suffix: def.word.slice(typedWord.length), word: def.word, canComplete: true };
      }
      return { suffix: '', word: '', canComplete: false };
    }
    // Recognized command: mirror the from:/in: ghost (popupFilterHint) - preview the highlighted
    // People/Channels row and complete it as you type. askai/record have no picker (no row).
    if (parsedCommand.kind === 'askai' || parsedCommand.kind === 'record' || !activeItemLabel) {
      return { suffix: '', word: '', canComplete: false };
    }
    if (!commandQuery) {
      // At rest the first row is arbitrary, so show only the action until the user navigates; once
      // navigated, preview the highlighted row name.
      const gap = /\s$/.test(commandText) ? '' : '\u00a0';
      return {
        suffix: hasNavigated
          ? `${gap}${activeItemLabel}\u00a0\u2013 Select`
          : `${gap}\u2013 Select`,
        word: '',
        canComplete: false,
      };
    }
    // Query typed: inline-complete the highlighted row name, then the action.
    if (activeItemLabel.toLowerCase().startsWith(commandQuery.toLowerCase())) {
      const completion = activeItemLabel.slice(commandQuery.length).replace(/^ /, '\u00a0');
      return { suffix: `${completion}\u00a0\u2013 Select`, word: '', canComplete: false };
    }
    return { suffix: '', word: '', canComplete: false };
  }, [
    commandText,
    commandTarget,
    parsedCommand,
    activeCommandWord,
    activeItemLabel,
    commandQuery,
    hasNavigated,
  ]);

  const onSetTextReady = useCallback((setText: (text: string) => void): void => {
    setTextRef.current = setText;
  }, []);

  // The command branch of the editor's onChange. Keeps `/`-text out of the search hook (Vespa never
  // runs); clears stale search once on the transition in. Returns true when the text is a command.
  const handleEditorText = useCallback(
    (text: string): boolean => {
      if (text.startsWith('/')) {
        // On *entering* command mode (previous text wasn't a command), clear any stale search
        // results/pagination. Gated on the transition (via the ref) so it runs once.
        if (!commandTextRef.current.startsWith('/')) resetSearchState();
        commandTextRef.current = text;
        setCommandText(text);
        setActiveCommandWord(null);
        return true;
      }
      // Not (or no longer) a command — make sure command mode is cleared.
      commandTextRef.current = '';
      setCommandText('');
      return false;
    },
    [resetSearchState],
  );

  return {
    commandActive,
    commandKind,
    commandText,
    commandTarget,
    isComposing,
    pendingChannelCall,
    commandUserResults,
    commandChannelResults,
    commandGhost,
    setActiveCommandWord,
    setPendingChannelCall,
    resetCommand,
    exitCommandMode,
    clearTarget,
    applyCommand,
    openAskAI,
    openRecordings,
    runCommandTarget,
    startChannelCall,
    isInCommandMode,
    onSetTextReady,
    handleEditorText,
  };
}
