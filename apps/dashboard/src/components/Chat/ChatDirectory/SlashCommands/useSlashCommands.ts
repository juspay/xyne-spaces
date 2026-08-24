import { useState, useRef, useMemo, useCallback, useEffect } from 'react';
import { useLocation, useParams } from 'react-router-dom';
import {
  SlidersHorizontal,
  User as UserIcon,
  MessagesSquare,
  FileText,
  Bookmark,
  Inbox,
  type LucideIcon,
} from 'lucide-react';
import { ChannelScopeType } from '@xyne/shared';
import type { User, Channel } from '@xyne/shared';
import { parseSearchCommand, COMMAND_KINDS, getCommand, type SearchCommandKind } from './commands';
import { useQuickCall } from '../../../../hooks/useQuickCall';
import { useUsers } from '../../../../hooks/useUsers';
import { useChannelSearch, useAllVisibleChannels } from '../../../../hooks/useChannels';
import { useLastVisitedChannel } from '../../../../hooks/useLastVisitedChannel';
import { CMDK_USER_LIMIT } from '../../../../hooks/useSearchMetrics';
import {
  rankChannelsByAffinity,
  filterChannelsBySearchableNames,
} from '../../../../utils/rankingUtils';
import { useRankedActivePeople } from '../../../../hooks/useRankedPeopleSearch';
import { useAffinityCallback } from '../../../../hooks/useAffinityCallback';
import { useVisibleNavigationItems } from '../../../../hooks/useVisibleNavigationItems';
import type { NavigationItem } from '../../../AppSidebar/navigationConfig';
import { xyneAIActor } from '../../../../machines/xyneAIMachine';
import { sendRecordingEvent, getRecordingStatus } from '../../../../hooks/useRecordingStore';
import { getUserDisplayName } from '../../../../utils/userDisplayName';
import { getDMNames, isOneToOneDMChannel } from '../ChatDirectory.utils';
import type { CommandTarget } from './QuickDmComposer';

/**
 * `/goto` label match: every whitespace-separated query token must prefix a word
 * in the label. So "work man" finds "Workspace Management" (out-of-order and
 * partial words work), not just a contiguous substring. Mirrors the AND-token
 * matching used by channel search. Empty query matches everything.
 */
function labelMatchesTokens(label: string, query: string): boolean {
  const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return true;
  const words = label.toLowerCase().split(/\s+/).filter(Boolean);
  return tokens.every(token => words.some(word => word.startsWith(token)));
}

/**
 * A slash-command "click" for usage metrics: a command row being applied
 * (`stage: 'command'`) or a target row being picked (`stage: 'target'`).
 * `terminal` marks the click that actually executes the command (drives the
 * session-end reason). The selection gesture (mouse/tab/arrow+enter) is added
 * by the parent, which owns the keyboard/mouse handlers.
 */
export interface SlashCommandClickInfo {
  stage: 'command' | 'target';
  command: SearchCommandKind;
  terminal: boolean;
  targetType?: 'user' | 'channel';
  destination?: string;
  /** How a chat/call target was reached: typing the `/`-prefix vs the ⌥↵ Actions menu. */
  source?: 'slash' | 'actions_menu';
}

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
  /** Metrics: emit a slash-command click (command applied / target picked). Optional. */
  onCommandClick?: (info: SlashCommandClickInfo) => void;
  /**
   * User ID → recency index in the 1:1 DM list (0 = most recent). Shared with the main Cmd+K
   * people ranking so the `/chat`/`/call` user picker uses the same affinity-then-recency order.
   */
  dmContactRecency: Map<string, number>;
}

interface CommandGhost {
  suffix: string;
  word: string;
  canComplete: boolean;
}

/** A group-DM picker row: the channel plus its resolved participant-name label. */
export interface CommandGroupDm {
  channel: Channel;
  label: string;
}

/**
 * A `/goto` destination that runs an action instead of routing to a static path. The rail sections
 * come from the nav-bar config (routes); these are the few destinations that aren't rail routes —
 * Preferences (a modal) and Profile (a dynamic route) — so they carry their own behaviour.
 */
export interface GotoExtra {
  id: string;
  label: string;
  icon: LucideIcon;
  run: () => void;
  /** Pin above the `/goto` "Navigate" sections (a destination, not a setting). */
  pinTop?: boolean;
}

export interface UseSlashCommandsReturn {
  commandActive: boolean;
  commandKind: SearchCommandKind | null;
  commandText: string;
  commandTarget: CommandTarget | null;
  isComposing: boolean;
  pendingChannelCall: { id: string; name: string } | null;
  /** True when `/record` was invoked while a recording is already active — drives the conflict dialog. */
  recordingConflict: boolean;
  setRecordingConflict: (value: boolean) => void;
  commandUserResults: User[];
  commandChannelResults: Channel[];
  commandGroupDmResults: CommandGroupDm[];
  commandNavResults: NavigationItem[];
  currentUserID: string;
  commandGotoExtras: GotoExtra[];
  commandGhost: CommandGhost;
  setActiveCommandWord: (word: string | null) => void;
  setPendingChannelCall: (value: { id: string; name: string } | null) => void;
  resetCommand: () => void;
  exitCommandMode: () => void;
  clearTarget: () => void;
  applyCommand: (word: string, options?: { silent?: boolean }) => void;
  runActionCommand: (kind: SearchCommandKind) => void;
  runNavSection: (item: NavigationItem) => void;
  runGotoExtra: (extra: GotoExtra) => void;
  runCommandTarget: (target: CommandTarget) => void;
  /** Run chat/call on a highlighted Cmd+K result (⌥↵ Actions menu), bypassing the `/`-command step. */
  invokeActionOnTarget: (kind: 'chat' | 'call', target: CommandTarget) => void;
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
  onCommandClick,
  dmContactRecency,
}: UseSlashCommandsParams): UseSlashCommandsReturn {
  // One shared signal that affinity weights have loaded — reuses the app-wide AffinityService
  // instance (no extra /users/me/affinity call), and re-ranks the at-rest picker when weights land.
  const affinityVersion = useAffinityCallback();
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
  // `/record` fired while a recording is already active — surfaces a dialog instead of starting a
  // second session. Independent of the command lifecycle (like pendingChannelCall) so it survives
  // the Cmd+K close that runs right after the command dispatches.
  const [recordingConflict, setRecordingConflict] = useState(false);

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
  // Resolve the active command's descriptor once; picker detection + dispatch read fields off it.
  const commandDef = commandKind ? getCommand(commandKind) : null;
  // A picked target for a `compose` picker (`/chat`) opens the composer; a `call` picker fires or
  // opens the confirm modal. A user for `/call` fires instantly and never sets a target.
  const isComposing =
    commandTarget !== null &&
    commandDef?.type === 'picker' &&
    commandDef.pickerAction === 'compose';
  // Only picker commands (`/call`/`/chat`) have a target picker; action commands take no argument.
  const isPickerCommand = commandDef?.type === 'picker';
  // `/chat` (compose) may target your own self-DM; `/call` cannot (you can't call yourself).
  const isComposePicker = commandDef?.type === 'picker' && commandDef.pickerAction === 'compose';
  // `/goto` lists nav-bar sections; it takes a plain query (no `@`/`#` scoping) like the pickers.
  const isNav = commandDef?.type === 'goto';
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
  const commandQuery = isPickerCommand
    ? commandScope
      ? commandArg.slice(1)
      : commandArg
    : isNav
      ? commandArg
      : '';
  const showUserResults = commandScope !== 'channel';
  const showChannelResults = commandScope !== 'user';

  const allUsers = useUsers();
  const usersById = useMemo(() => new Map(allUsers.map(u => [u.id, u])), [allUsers]);
  // Same recipe as the main Cmd+K people list, via the shared hook: active-user candidates →
  // relevance tier → MFU affinity → DM recency. Opts reproduce the picker's legacy behavior exactly
  // (seeding + substring-fallback OFF), so this is a no-op swap of the previous inline logic:
  //   /call — self can't be a target: exclude it from candidates AND the recovery pool.
  //   /chat — self-DM is valid: inject self at rest so it stays reachable, ranked (not pinned).
  const rankedCommandUsers = useRankedActivePeople(
    commandQuery,
    CMDK_USER_LIMIT,
    isComposePicker
      ? {
          ensureUserIdAtRest: currentUserID,
          recoveryPool: allUsers,
          dmContactRecency,
          seedDmContactsAtRest: false,
          substringFallback: false,
        }
      : {
          excludeUserId: currentUserID,
          recoveryPool: allUsers,
          dmContactRecency,
          seedDmContactsAtRest: false,
          substringFallback: false,
        },
  );
  const commandUserResults = useMemo(
    () => (showUserResults ? rankedCommandUsers : []),
    [showUserResults, rankedCommandUsers],
  );
  // Channel picker candidates: real group channels (DEFAULT scope) the user can access.
  const commandChannels = useChannelSearch(commandQuery, CMDK_USER_LIMIT);
  const visibleChannels = useAllVisibleChannels();
  const commandChannelResults = useMemo(() => {
    if (!showChannelResults) return [];
    void affinityVersion;
    const visibleIds = new Set(visibleChannels.map(c => c.id));
    const filtered = commandChannels.filter(
      c => c.scopeType === ChannelScopeType.DEFAULT && visibleIds.has(c.id),
    );
    // Empty query → affinity-then-recency (matches the Cmd+K channel browse order). A typed query
    // keeps the Fuse relevance order from useChannelSearch untouched.
    return commandQuery.trim() ? filtered : rankChannelsByAffinity(filtered);
  }, [showChannelResults, commandChannels, visibleChannels, commandQuery, affinityVersion]);

  // Group-DM picker candidates: the user's GROUP_DM channels, shown for both `/chat` and `/call`.
  // A group DM's `channel.name` is a comma-joined id list, so channel search can't match it by
  // name — resolve friendly participant labels here and filter on those instead.
  const commandGroupDmResults = useMemo<CommandGroupDm[]>(() => {
    if (!isPickerCommand || !showChannelResults) return [];
    void affinityVersion;
    const groups = visibleChannels
      .filter(c => c.scopeType === ChannelScopeType.GROUP_DM)
      .map(channel => {
        const dmNames = getDMNames(channel, currentUserID, usersById);
        return { channel, label: dmNames.display.join(', '), searchNames: dmNames.search };
      })
      .filter(g => g.label);
    const labelByChannelId = new Map(groups.map(g => [g.channel.id, g.label]));
    // Typed query → the same token-AND participant matcher as Cmd+K, so full names match (not just
    // the nickname label). Empty query → affinity-then-recency, matching the Cmd+K browse order.
    if (commandQuery.trim()) {
      return filterChannelsBySearchableNames(groups, commandQuery)
        .map(g => ({ channel: g.channel, label: labelByChannelId.get(g.channel.id) ?? '' }))
        .slice(0, CMDK_USER_LIMIT);
    }
    return rankChannelsByAffinity(groups.map(g => g.channel))
      .map(channel => ({ channel, label: labelByChannelId.get(channel.id) ?? '' }))
      .slice(0, CMDK_USER_LIMIT);
  }, [
    isPickerCommand,
    showChannelResults,
    commandQuery,
    visibleChannels,
    usersById,
    currentUserID,
    affinityVersion,
  ]);

  // `/goto` candidates: the nav-bar sections the current user can see (permission/electron/claw
  // gating comes from useVisibleNavigationItems), filtered by the typed query. New nav-bar entries
  // show up here automatically — no second list to maintain.
  const visibleNavItems = useVisibleNavigationItems();
  const commandNavResults = useMemo<NavigationItem[]>(() => {
    if (!isNav) return [];
    const query = commandQuery.trim().toLowerCase();
    if (!query) return visibleNavItems;
    return visibleNavItems.filter(item => labelMatchesTokens(item.label, query));
  }, [isNav, commandQuery, visibleNavItems]);

  // `/goto` also reaches destinations that aren't rail routes: Preferences (a modal, opened via the
  // app-wide `xyne-open-preferences` event) and Profile (a dynamic route built from the general
  // channel + the user). They can't live in NAVIGATION_ITEMS, so they're a small list defined here.
  // Profile is a route nested under a conversation (/chat/dir/:channelId/profile/:userId), so it
  // needs a channel to anchor it. Use whichever conversation is currently open; if none is, fall
  // back to the last-visited one (the conversation Chat reopens by default).
  const location = useLocation();
  const { workspaceId } = useParams<{ workspaceId?: string }>();
  const lastVisitedChannelId = useLastVisitedChannel(workspaceId ?? '');
  const currentChannelId = useMemo((): string | null => {
    const parts = location.pathname.split('/').filter(Boolean);
    const chatIndex = parts.indexOf('chat');
    if (chatIndex === -1) return null;
    // A conversation lives under one of these chat contexts, with its id one segment later.
    const context = parts[chatIndex + 1];
    const hasChannel =
      context === 'dir' || context === 'dm' || context === 'bookmarks' || context === 'activity';
    return hasChannel ? (parts[chatIndex + 2] ?? null) : null;
  }, [location.pathname]);
  const profileChannelId = currentChannelId ?? lastVisitedChannelId;
  const gotoExtras = useMemo<GotoExtra[]>(
    () => [
      {
        id: 'threads',
        label: 'Threads',
        icon: MessagesSquare,
        pinTop: true,
        run: (): void => {
          navigate('/chat/dir/threads');
        },
      },
      {
        id: 'drafts',
        label: 'Drafts',
        icon: FileText,
        pinTop: true,
        run: (): void => {
          // The old /chat/drafts route redirects here; go straight to the canonical page.
          navigate('/chat/drafts-sent?tab=drafts');
        },
      },
      {
        id: 'bookmarks',
        label: 'Bookmarks',
        icon: Bookmark,
        pinTop: true,
        run: (): void => {
          navigate('/chat/bookmarks');
        },
      },
      {
        id: 'unreads',
        label: 'Unreads',
        icon: Inbox,
        pinTop: true,
        run: (): void => {
          navigate('/chat/dir/unreads');
        },
      },
      {
        id: 'preferences',
        label: 'Preferences',
        icon: SlidersHorizontal,
        run: (): void => {
          window.dispatchEvent(new CustomEvent('xyne-open-preferences'));
        },
      },
      {
        id: 'profile',
        label: 'Profile',
        icon: UserIcon,
        run: (): void => {
          // Anchor the profile on the open/last conversation. With neither (nothing ever opened),
          // just land on Chat so the directory can resolve a conversation.
          if (profileChannelId) {
            navigate(`/chat/dir/${profileChannelId}/profile/${currentUserID}`);
          } else {
            navigate('/chat/dir');
          }
        },
      },
    ],
    [profileChannelId, navigate, currentUserID],
  );
  const commandGotoExtras = useMemo<GotoExtra[]>(() => {
    if (!isNav) return [];
    const query = commandQuery.trim().toLowerCase();
    if (!query) return gotoExtras;
    return gotoExtras.filter(extra => labelMatchesTokens(extra.label, query));
  }, [isNav, commandQuery, gotoExtras]);

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
  const applyCommand = useCallback(
    (word: string, options?: { silent?: boolean }): void => {
      const text = `/${word} `;
      // Mirror the command text into the ref/state synchronously so isInCommandMode() is correct
      // before Lexical's onChange fires — otherwise the mention-trigger guards briefly treat the
      // input as a normal search.
      commandTextRef.current = text;
      setCommandText(text);
      setTextRef.current?.(text);
      // Metrics: command row applied (not terminal — the picker/target step follows). Skipped when
      // `silent`: the ⌥↵ Actions menu seeds `/chat ` here only to reach the composer — the user
      // never applied a `/chat` command, so a command-stage click would be a phantom event.
      if (!options?.silent && (COMMAND_KINDS as string[]).includes(word)) {
        onCommandClick?.({ stage: 'command', command: word as SearchCommandKind, terminal: false });
      }
    },
    [onCommandClick],
  );

  // Action commands (`/askai`, `/record`) take no target — dispatch the behaviour keyed by kind,
  // then close Cmd+K. Deps live here (not in the static catalog) so the table can close over the
  // hook's callbacks/actors; new action commands add one entry.
  const runActionCommand = useCallback(
    (kind: SearchCommandKind): void => {
      const handlers: Partial<Record<SearchCommandKind, () => void>> = {
        askai: () => xyneAIActor.send({ type: 'OPEN' }),
        // Start a recording in place — no navigation. The global RecordingOverlay pill surfaces it
        // wherever the user is. Any state other than idle/error means a recording is live or
        // transitioning (recording/paused/starting/stopping) — show a conflict dialog instead of
        // stacking a second session ('error' is a dead recording, so a fresh start is fine). Clear
        // transcripts first to match RecordingsScreen's start flow.
        record: () => {
          const status = getRecordingStatus();
          if (status !== 'idle' && status !== 'error') {
            setRecordingConflict(true);
            return;
          }
          sendRecordingEvent({ type: 'clearTranscripts' });
          sendRecordingEvent({ type: 'startRecording' });
        },
      };
      const handler = handlers[kind];
      if (!handler) return;
      handler();
      // Metrics: action commands (`/askai`, `/record`) execute at the command stage (terminal).
      onCommandClick?.({ stage: 'command', command: kind, terminal: true });
      exitCommandMode();
      onOpenChange(false);
    },
    [exitCommandMode, onOpenChange, onCommandClick],
  );

  // `/goto`: route to the picked nav-bar section and close Cmd+K. Like runActionCommand, the deps
  // live here (not in the static catalog) so it can close over the router `navigate`.
  const runNavSection = useCallback(
    (item: NavigationItem): void => {
      navigate(item.path);
      // Metrics: `/goto` target picked (a nav-bar route). Destination is an app path, not PII.
      onCommandClick?.({
        stage: 'target',
        command: 'goto',
        terminal: true,
        destination: item.path,
      });
      exitCommandMode();
      onOpenChange(false);
    },
    [navigate, exitCommandMode, onOpenChange, onCommandClick],
  );

  // `/goto` non-route destination: run its action (open the Preferences modal / route to Profile),
  // then close Cmd+K. The action itself is defined on the extra (it closes over the hook's deps).
  const runGotoExtra = useCallback(
    (extra: GotoExtra): void => {
      extra.run();
      // Metrics: `/goto` target picked (a modal/dynamic destination). Id is a constant, not PII.
      onCommandClick?.({
        stage: 'target',
        command: 'goto',
        terminal: true,
        destination: extra.id,
      });
      exitCommandMode();
      onOpenChange(false);
    },
    [exitCommandMode, onOpenChange, onCommandClick],
  );

  // Fire or confirm a call for the picked target. Shared by `/call` (runCommandTarget) and the
  // Cmd+K result Actions menu (invokeActionOnTarget) so both take the same guarded path: a 1:1 call
  // fires instantly; a live channel call is joined; a new channel-wide call asks for confirmation.
  const dispatchCall = useCallback(
    (target: CommandTarget): void => {
      if (target.type === 'user') {
        // A 1:1 call fires instantly, matching the rest of the app.
        startCall(target.user.id, getUserDisplayName(target.user));
      } else if (
        hasActiveChannelCall(target.channel.id) ||
        isOneToOneDMChannel(target.channel.scopeType)
      ) {
        // Start the call directly (no "Start a call in this channel?" confirm) when either: a call
        // is already live on the channel (you're joining, not broadcasting), OR it's a 1:1 DM —
        // structurally a channel but really a direct call to one person (e.g. a starred user). Group
        // DMs pass their friendly label (channel.name is an id list).
        startChannelCall(target.channel.id, target.displayName ?? target.channel.name);
      } else if (ensureRoomIdle()) {
        // No call yet — confirm before starting a new channel-wide call. The modal renders as a
        // sibling of the Cmd+K dialog, so closing Cmd+K here doesn't tear it down.
        setPendingChannelCall({
          id: target.channel.id,
          name: target.displayName ?? target.channel.name,
        });
      }
      exitCommandMode();
      onOpenChange(false);
    },
    [
      startCall,
      startChannelCall,
      hasActiveChannelCall,
      ensureRoomIdle,
      setPendingChannelCall,
      exitCommandMode,
      onOpenChange,
    ],
  );

  const runCommandTarget = useCallback(
    (target: CommandTarget): void => {
      const def = commandKind ? getCommand(commandKind) : null;
      if (def?.type !== 'picker' || !commandKind) return;
      // Metrics: target picked. `/call` fires immediately (terminal → session 'invoke'); `/chat`
      // only *opens* the composer here — it's invoked when a message is actually sent (see the
      // composer's onSent), so this pick is non-terminal and escaping the composer is an 'abandon'.
      // Log only the target *type*, never the recipient.
      onCommandClick?.({
        stage: 'target',
        command: commandKind,
        terminal: def.pickerAction === 'call',
        targetType: target.type,
        source: 'slash',
      });
      if (def.pickerAction === 'call') {
        dispatchCall(target);
        return;
      }
      // `compose` (`/chat`): open the composer for the picked user/channel.
      selectTarget(target);
    },
    [commandKind, dispatchCall, selectTarget, onCommandClick],
  );

  // Cmd+K result Actions menu (⌥↵): run chat/call on a highlighted user/channel result *without*
  // first typing `/chat`|`/call`. `commandKind` is derived from the editor text, so we can't set it
  // and reuse runCommandTarget — instead dispatch the call directly, or (for chat) seed the hidden
  // `/chat ` text via applyCommand then open the composer with selectTarget. The seeded text is what
  // the composer's "back" button reads, so this path needs no special-casing there.
  const invokeActionOnTarget = useCallback(
    (kind: 'chat' | 'call', target: CommandTarget): void => {
      // Metrics: target picked. `/call` is terminal; `/chat` opens the composer (invoked on send).
      onCommandClick?.({
        stage: 'target',
        command: kind,
        terminal: kind === 'call',
        targetType: target.type,
        source: 'actions_menu',
      });
      if (kind === 'call') {
        dispatchCall(target);
        return;
      }
      // Seed `/chat ` only to open the composer — silent so it doesn't log a phantom command-apply
      // click (the `stage:'target'` click above already recorded this pick, with `source`).
      applyCommand('chat', { silent: true });
      selectTarget(target);
    },
    [dispatchCall, applyCommand, selectTarget, onCommandClick],
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
      // Bare `/` at rest (nothing typed, no row hovered or arrowed yet): show a "Quick commands" hint
      // rather than previewing an arbitrary first command — mirrors the pickers' at-rest label.
      if (!typedWord && !hasNavigated && !activeCommandWord) {
        return { suffix: ' Quick commands', word: '', canComplete: false };
      }
      const matches = COMMAND_KINDS.filter(k => k.startsWith(typedWord));
      const kind = matches.find(k => k === activeCommandWord) ?? matches[0];
      if (kind) {
        // Inline-complete the command word, then the " – Select" action (mirrors the picker rows).
        const completion = kind.slice(typedWord.length);
        return { suffix: `${completion}\u00a0\u2013 Select`, word: kind, canComplete: true };
      }
      return { suffix: '', word: '', canComplete: false };
    }
    // Recognized command: mirror the from:/in: ghost (popupFilterHint) - preview the highlighted
    // People/Channels row and complete it as you type. askai/record have no picker (no row).
    if (getCommand(parsedCommand.kind).type === 'action' || !activeItemLabel) {
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
    recordingConflict,
    setRecordingConflict,
    commandUserResults,
    commandChannelResults,
    commandGroupDmResults,
    commandNavResults,
    currentUserID,
    commandGotoExtras,
    commandGhost,
    setActiveCommandWord,
    setPendingChannelCall,
    resetCommand,
    exitCommandMode,
    clearTarget,
    applyCommand,
    runActionCommand,
    runNavSection,
    runGotoExtra,
    runCommandTarget,
    invokeActionOnTarget,
    startChannelCall,
    isInCommandMode,
    onSetTextReady,
    handleEditorText,
  };
}
