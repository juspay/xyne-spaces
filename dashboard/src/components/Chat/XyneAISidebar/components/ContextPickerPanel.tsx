import type { ReactElement } from 'react';
import { useState, useCallback, useMemo, useRef } from 'react';
import GlobalCommandMenu from '../../../GlobalCommandMenu/GlobalCommandMenu';
import type { ContextItem } from '../../ThreadContextPanel/ThreadContextPanel.types';
import { TabType } from '../../ChatDirectory/ChannelCommandMenu.types';

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
}

export interface SelectedTranscript {
  id: string;
  title: string;
}

export interface SelectedRecording {
  id: string;
  title: string;
}

export interface ContextSelections {
  channels: SelectedChannel[];
  tickets: SelectedTicket[];
  canvases: SelectedCanvas[];
  transcripts: SelectedTranscript[];
  recordings: SelectedRecording[];
}
import { saveRecents } from '../../../../utils/contextPickerRecents';
import { toast } from 'sonner';

// ─── Constants ────────────────────────────────────────────────────────────────

const MAX_CHANNELS = 5;
const MAX_CONTEXT_ITEMS = 5;

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
        const subApp = item.searchResult?.searchContext?.subApp?.toLowerCase();
        const currentTab = currentTabRef.current;

        if (subApp === 'canvas') {
          setSelectedCanvases(prev => {
            const next = new Map(prev);
            if (next.has(rawId)) {
              next.delete(rawId);
            } else {
              if (!checkNonChannelLimit()) return prev;
              next.set(rawId, { id: rawId, title });
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
                next.set(rawId, { id: rawId, title });
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
                next.set(rawId, { id: rawId, title });
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
    <div className='h-[420px] flex flex-col overflow-hidden rounded-2xl bg-white border border-gray-200 shadow-[0px_7px_15px_0px_#0000000D,0px_28px_28px_0px_#00000017,0px_62px_37px_0px_#0000000D,0px_111px_44px_0px_#00000003,0px_173px_48px_0px_#00000000]'>
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
        />
      </div>

      {/* Confirm footer */}
      <div className='flex-shrink-0 border-t border-gray-200 px-4 py-2 flex items-center justify-between bg-[#FAFAFA] rounded-b-2xl'>
        <span className='text-xs text-gray-500'>
          {totalSelected > 0
            ? `${totalSelected} item${totalSelected === 1 ? '' : 's'} selected`
            : 'Select items to add to context'}
        </span>
        <div className='flex items-center gap-2'>
          <button
            onClick={onClose}
            className='px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-100 rounded-lg transition-colors'
            data-track-category='XyneAI'
            data-track-name='CONTEXT_PICKER_CANCEL'
          >
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            disabled={totalSelected === 0}
            className='px-3 py-1.5 text-xs font-medium bg-gray-900 text-white rounded-lg hover:bg-gray-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors'
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
