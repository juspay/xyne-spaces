import type { ReactElement } from 'react';
import { useState, useCallback, useMemo, useRef } from 'react';
import GlobalCommandMenu from '../../../GlobalCommandMenu/GlobalCommandMenu';
import type { ContextItem } from '../../ThreadContextPanel/ThreadContextPanel.types';
import { TabType } from '../../ChatDirectory/ChannelCommandMenu.types';
import type { CanvasRole } from '../utils/XyneAITypes';

// ─── Exported Types ───────────────────────────────────────────────────────────

export interface SelectedChannel {
  id: string;
  name: string;
  isPrivate: boolean;
}

export interface SelectedTicket {
  id: string;
  title: string;
  xyneId?: string;
  status?: string;
}

export interface SelectedCanvas {
  id: string;
  title: string;
  /**
   * Canvas id for `/chat/canvas/:id`. Kept separate from `id`, which prefers the
   * attachment id for dedupe and is not what the canvas route accepts.
   */
  canvasId?: string;
  /**
   * What this canvas IS, when the attaching screen knows. A recording attaches two
   * canvases that look identical from their row alone — the machine-written summary
   * and the human's own notes — and the agent has to weigh them very differently.
   * Undefined for a canvas the user picked by hand; the agent then treats it as a
   * plain document.
   */
  canvasRole?: CanvasRole;
}

/**
 * Calls and recordings are both indexed as TRANSCRIPT files shared into a
 * conversation, so both carry the chat location the transcript lives at — that
 * is what `navigateToTranscript` (utils/searchNavigation.ts) targets.
 */
export interface SelectedTranscript {
  id: string;
  title: string;
  channelId?: string;
  conversationId?: string;
}

export interface SelectedRecording {
  id: string;
  title: string;
  channelId?: string;
  conversationId?: string;
  /** Recording id for `/recordings/:id`, when the search result carries one. */
  externalId?: string;
}

export interface ContextSelections {
  channels: SelectedChannel[];
  tickets: SelectedTicket[];
  canvases: SelectedCanvas[];
  transcripts: SelectedTranscript[];
  recordings: SelectedRecording[];
}

// Attached context item for v2 API. The KB types ('collection' | 'folder' |
// 'file') are not sent by the composer directly — the Spaces backend merges
// them into attachedContext from collectionIds/folderIds/fileIds (see
// xyneAIControllerV2.ts) and persists them, so a reloaded message carries them.
export interface AttachedContextItem {
  type: 'channel' | 'ticket' | 'canvas' | 'call' | 'activity' | 'collection' | 'folder' | 'file';
  id: string;
  title: string;
  threadId?: string;
  /** Canvas items only — see SelectedCanvas.canvasRole. */
  canvasRole?: CanvasRole;
  // For activity items
  eventName?: string;
  eventCategory?: string;
  timestamp?: string;
  metadata?: Record<string, unknown>;
  relatedData?: Record<string, unknown>;
}

/**
 * Convert ContextSelections to attachedContext format for v2 API
 */
export function toAttachedContext(selections: ContextSelections): AttachedContextItem[] {
  const items: AttachedContextItem[] = [];

  for (const channel of selections.channels) {
    items.push({
      type: 'channel',
      id: channel.id,
      title: channel.name,
    });
  }

  for (const ticket of selections.tickets) {
    items.push({
      type: 'ticket',
      id: ticket.id,
      title: ticket.title,
    });
  }

  for (const canvas of selections.canvases) {
    items.push({
      type: 'canvas',
      id: canvas.id,
      title: canvas.title,
      ...(canvas.canvasRole ? { canvasRole: canvas.canvasRole } : {}),
    });
  }

  // Transcripts and recordings are both treated as 'call' type
  for (const transcript of selections.transcripts) {
    items.push({
      type: 'call',
      id: transcript.id,
      title: transcript.title,
      ...(transcript.conversationId ? { threadId: transcript.conversationId } : {}),
    });
  }

  for (const recording of selections.recordings) {
    items.push({
      type: 'call',
      id: recording.id,
      title: recording.title,
      ...(recording.conversationId ? { threadId: recording.conversationId } : {}),
    });
  }

  return items;
}

/**
 * Selections plus the collection/file scopes that live outside {@link
 * ContextSelections} — the full set a composer needs to re-populate its
 * editable pills. Produced by {@link attachedContextToSelections}.
 */
export interface ReusableContext extends ContextSelections {
  collections: { id: string; name: string }[];
  fileScopes: { id: string; name: string }[];
  folderScopes: { id: string; name: string }[];
}

/**
 * Inverse of {@link toAttachedContext}: turn a persisted attachedContext list
 * (from a past user turn) back into the composer's editable selection buckets,
 * so "reuse this context" drops the same pills a manual pick would. Calls
 * (`type: 'call'`) restore as transcripts — the two are indistinguishable once
 * normalized and behave identically for the query (both become call ids).
 * `activity` items are runtime-only user-activity context and are skipped.
 * `collection`/`file` are backend-only types (merged in from KB items) not in
 * the frontend union, so this switches on the raw string.
 */
export function attachedContextToSelections(items: AttachedContextItem[]): ReusableContext {
  const result: ReusableContext = {
    channels: [],
    tickets: [],
    canvases: [],
    transcripts: [],
    recordings: [],
    collections: [],
    fileScopes: [],
    folderScopes: [],
  };
  for (const item of items) {
    switch (item.type as string) {
      case 'channel':
        result.channels.push({ id: item.id, name: item.title, isPrivate: false });
        break;
      case 'ticket':
        result.tickets.push({ id: item.id, title: item.title });
        break;
      case 'canvas':
        result.canvases.push({
          id: item.id,
          title: item.title,
          ...(item.canvasRole ? { canvasRole: item.canvasRole } : {}),
        });
        break;
      case 'call':
        result.transcripts.push({
          id: item.id,
          title: item.title,
          ...(item.threadId ? { conversationId: item.threadId } : {}),
        });
        break;
      case 'collection':
        result.collections.push({ id: item.id, name: item.title });
        break;
      case 'folder':
        result.folderScopes.push({ id: item.id, name: item.title });
        break;
      case 'file':
        result.fileScopes.push({ id: item.id, name: item.title });
        break;
      default:
        // 'activity' and any future type — nothing to re-attach as a pill.
        break;
    }
  }
  return result;
}
import { saveRecents } from '../../../../utils/contextPickerRecents';
import { toast } from 'sonner';

// ─── Constants ────────────────────────────────────────────────────────────────

const MAX_CHANNELS = 5;
const MAX_CONTEXT_ITEMS = 20;

const ENABLED_TABS: TabType[] = [
  TabType.CHANNELS,
  TabType.TICKETS,
  TabType.CANVAS,
  TabType.CALL,
  TabType.RECORDING,
];

// ─── Props ────────────────────────────────────────────────────────────────────

interface ContextPickerPanelProps {
  onClose: () => void;
  onConfirm: (selections: ContextSelections) => void;
  initialSelections: ContextSelections;
}

// ─── Component ────────────────────────────────────────────────────────────────

export const ContextPickerPanel = ({
  onClose,
  onConfirm,
  initialSelections,
}: ContextPickerPanelProps): ReactElement => {
  // ── Selection maps (unified model: includes both committed items from initialSelections
  // and newly picked items in this session). Committed items start as selected.
  const [selectedChannels, setSelectedChannels] = useState<Map<string, SelectedChannel>>(
    () => new Map(initialSelections.channels.map(c => [c.id, c])),
  );
  const [selectedTickets, setSelectedTickets] = useState<Map<string, SelectedTicket>>(
    () => new Map(initialSelections.tickets.map(t => [t.id, t])),
  );
  const [selectedCanvases, setSelectedCanvases] = useState<Map<string, SelectedCanvas>>(
    () => new Map(initialSelections.canvases.map(c => [c.id, c])),
  );
  const [selectedTranscripts, setSelectedTranscripts] = useState<Map<string, SelectedTranscript>>(
    () => new Map(initialSelections.transcripts.map(t => [t.id, t])),
  );
  const [selectedRecordings, setSelectedRecordings] = useState<Map<string, SelectedRecording>>(
    () => new Map(initialSelections.recordings.map(r => [r.id, r])),
  );

  // Tracks the active tab inside GlobalCommandMenu to disambiguate call vs recording
  // (both use subApp='transcript' so we rely on which tab was active when toggled)
  const currentTabRef = useRef<TabType>(TabType.CHANNELS);

  // ── contextItems for checkmark display in GlobalCommandMenu ───────────────

  const contextItems = useMemo((): ContextItem[] => {
    const items: ContextItem[] = [];
    const makeResult = (
      id: string,
      title: string,
      type: ContextItem['type'],
    ): ContextItem['searchResult'] => ({
      id,
      type,
      title,
      subtitle: '',
      relevanceScore: 0,
      metadata: {},
    });

    selectedChannels.forEach((item, id) => {
      items.push({
        id: `channel-${id}`,
        title: item.name,
        type: 'channel',
        url: `/chat/dir/${id}`,
        searchResult: makeResult(id, item.name, 'channel'),
      });
    });
    selectedTickets.forEach((item, id) => {
      items.push({
        id: `ticket-${id}`,
        title: item.title,
        type: 'ticket',
        url: '#',
        searchResult: makeResult(id, item.title, 'ticket'),
      });
    });
    selectedCanvases.forEach((item, id) => {
      items.push({
        id: `attachment-${id}`,
        title: item.title,
        type: 'attachment',
        url: '#',
        searchResult: makeResult(id, item.title, 'attachment'),
      });
    });
    selectedTranscripts.forEach((item, id) => {
      items.push({
        id: `attachment-${id}`,
        title: item.title,
        type: 'attachment',
        url: '#',
        searchResult: makeResult(id, item.title, 'attachment'),
      });
    });
    selectedRecordings.forEach((item, id) => {
      items.push({
        id: `attachment-${id}`,
        title: item.title,
        type: 'attachment',
        url: '#',
        searchResult: makeResult(id, item.title, 'attachment'),
      });
    });
    return items;
  }, [
    selectedChannels,
    selectedTickets,
    selectedCanvases,
    selectedTranscripts,
    selectedRecordings,
  ]);

  // ── Non-channel count for limit checks ───────────────────────────────────

  const totalNonChannelSelected =
    selectedTickets.size +
    selectedCanvases.size +
    selectedTranscripts.size +
    selectedRecordings.size;

  const checkNonChannelLimit = useCallback((): boolean => {
    if (totalNonChannelSelected >= MAX_CONTEXT_ITEMS) {
      toast.error(`Maximum ${MAX_CONTEXT_ITEMS} context items can be selected`, { duration: 2000 });
      return false;
    }
    return true;
  }, [totalNonChannelSelected]);

  // ── Handle item toggle from GlobalCommandMenu ─────────────────────────────

  const handleContextItemToggle = useCallback(
    (item: ContextItem): void => {
      // Extract raw ID — use attachmentId when available (matches ContextSearchModal convention)
      const rawId =
        item.searchResult?.searchContext?.attachmentId ?? item.searchResult?.id ?? item.id;
      const title = item.title;

      if (item.type === 'channel') {
        setSelectedChannels(prev => {
          const next = new Map(prev);
          if (next.has(rawId)) {
            next.delete(rawId);
          } else {
            if (next.size >= MAX_CHANNELS) {
              toast.error(`Maximum ${MAX_CHANNELS} channels can be selected`, { duration: 2000 });
              return prev;
            }
            const isPrivate = item.searchResult?.searchContext?.scopeType === 'PRIVATE';
            next.set(rawId, { id: rawId, name: title, isPrivate });
          }
          return next;
        });
      } else if (item.type === 'ticket') {
        setSelectedTickets(prev => {
          const next = new Map(prev);
          if (next.has(rawId)) {
            next.delete(rawId);
          } else {
            if (!checkNonChannelLimit()) return prev;
            const xyneId = item.searchResult?.searchContext?.xyneId;
            const status = item.searchResult?.searchContext?.ticketStatus;
            const entry: SelectedTicket = { id: rawId, title };
            if (xyneId) entry.xyneId = xyneId;
            if (status) entry.status = status;
            next.set(rawId, entry);
          }
          return next;
        });
      } else if (item.type === 'attachment') {
        const searchContext = item.searchResult?.searchContext;
        const subApp = searchContext?.subApp?.toLowerCase();
        const currentTab = currentTabRef.current;
        // Where the pill navigates to. `rawId` can't stand in for these: it
        // prefers the attachment id, which neither route accepts.
        const location = {
          ...(searchContext?.channelId ? { channelId: searchContext.channelId } : {}),
          ...(searchContext?.conversationId
            ? { conversationId: searchContext.conversationId }
            : {}),
        };

        if (subApp === 'canvas') {
          setSelectedCanvases(prev => {
            const next = new Map(prev);
            if (next.has(rawId)) {
              next.delete(rawId);
            } else {
              if (!checkNonChannelLimit()) return prev;
              next.set(rawId, {
                id: rawId,
                title,
                ...(item.searchResult?.id ? { canvasId: item.searchResult.id } : {}),
              });
            }
            return next;
          });
        } else if (subApp === 'transcript') {
          // Both calls and recordings have subApp='transcript'.
          // Use currentTab to route to the correct selection map.
          if (currentTab === TabType.RECORDING) {
            setSelectedRecordings(prev => {
              const next = new Map(prev);
              if (next.has(rawId)) {
                next.delete(rawId);
              } else {
                if (!checkNonChannelLimit()) return prev;
                next.set(rawId, {
                  id: rawId,
                  title,
                  ...location,
                  ...(searchContext?.externalId ? { externalId: searchContext.externalId } : {}),
                });
              }
              return next;
            });
          } else {
            setSelectedTranscripts(prev => {
              const next = new Map(prev);
              if (next.has(rawId)) {
                next.delete(rawId);
              } else {
                if (!checkNonChannelLimit()) return prev;
                next.set(rawId, { id: rawId, title, ...location });
              }
              return next;
            });
          }
        }
      }
    },
    [checkNonChannelLimit],
  );

  // ── Handle tab change ─────────────────────────────────────────────────────

  // Track the active tab so handleContextItemToggle can disambiguate
  // call vs recording (both share subApp='transcript').
  const handleTabChange = useCallback((tab: TabType): void => {
    currentTabRef.current = tab;
  }, []);

  // ── Confirm ───────────────────────────────────────────────────────────────

  const totalSelected =
    selectedChannels.size +
    selectedTickets.size +
    selectedCanvases.size +
    selectedTranscripts.size +
    selectedRecordings.size;

  const handleConfirm = useCallback((): void => {
    const newChannels = Array.from(selectedChannels.values());
    const newTickets = Array.from(selectedTickets.values());
    const newCanvases = Array.from(selectedCanvases.values());
    const newTranscripts = Array.from(selectedTranscripts.values());
    const newRecordings = Array.from(selectedRecordings.values());

    if (newChannels.length > 0)
      saveRecents(
        TabType.CHANNELS,
        newChannels.map(c => ({ id: c.id, title: c.name, isPrivate: c.isPrivate })),
      );
    if (newTickets.length > 0)
      saveRecents(
        TabType.TICKETS,
        newTickets.map(t => ({ id: t.id, title: t.title })),
      );
    if (newCanvases.length > 0)
      saveRecents(
        TabType.CANVAS,
        newCanvases.map(c => ({ id: c.id, title: c.title })),
      );
    if (newTranscripts.length > 0)
      saveRecents(
        TabType.CALL,
        newTranscripts.map(t => ({ id: t.id, title: t.title })),
      );
    if (newRecordings.length > 0)
      saveRecents(
        TabType.RECORDING,
        newRecordings.map(r => ({ id: r.id, title: r.title })),
      );

    // Unified model: selected* Maps already contain the desired final state
    // (committed items that weren't unchecked, plus newly checked items)
    onConfirm({
      channels: newChannels,
      tickets: newTickets,
      canvases: newCanvases,
      transcripts: newTranscripts,
      recordings: newRecordings,
    });
    onClose();
  }, [
    selectedChannels,
    selectedTickets,
    selectedCanvases,
    selectedTranscripts,
    selectedRecordings,
    onConfirm,
    onClose,
  ]);

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className='h-[420px] flex flex-col overflow-hidden rounded-2xl bg-popover border border-border shadow-xl'>
      {/* Search + tabs + results */}
      <div className='flex-1 min-h-0 overflow-hidden'>
        <GlobalCommandMenu
          open={true}
          onOpenChange={open => {
            if (!open) onClose();
          }}
          contextSelectionMode
          contextItems={contextItems}
          onContextItemToggle={handleContextItemToggle}
          enabledTabs={ENABLED_TABS}
          inline
          onTabChange={handleTabChange}
          disableAutoFocus
        />
      </div>

      {/* Confirm footer */}
      <div className='flex-shrink-0 border-t border-border px-4 py-2 flex items-center justify-between bg-muted/50 rounded-b-2xl'>
        <span className='text-xs text-muted-foreground'>
          {totalSelected > 0
            ? `${totalSelected} item${totalSelected === 1 ? '' : 's'} selected`
            : 'Select items to add to context'}
        </span>
        <div className='flex items-center gap-2'>
          <button
            onClick={onClose}
            className='px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-accent rounded-lg transition-colors'
            data-track-category='XyneAI'
            data-track-name='CONTEXT_PICKER_CANCEL'
          >
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            disabled={totalSelected === 0}
            className='px-3 py-1.5 text-xs font-medium bg-action-primary text-action-primary-foreground rounded-lg hover:bg-action-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors'
            data-track-category='XyneAI'
            data-track-name='CONTEXT_PICKER_CONFIRM'
            data-track-metadata={JSON.stringify({ itemCount: totalSelected })}
          >
            Add to context
          </button>
        </div>
      </div>
    </div>
  );
};
