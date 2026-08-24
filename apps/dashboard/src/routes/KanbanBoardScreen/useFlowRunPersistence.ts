import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type RefObject,
  type SetStateAction,
} from 'react';
import type { FlowPlanModel } from '@xyne/shared';
import type { FlowNodeSelection } from '../../components/Board/FlowRun/FlowNodeSidePanel';
import {
  isRunRoot,
  mapPlanToRunTickets,
  type FlowRunTicket,
} from '../../components/Board/FlowRun/flowRun.utils';
import { VIRTUAL_ROOT_ID as FLOW_VIRTUAL_ROOT_ID } from '../../components/Board/FlowPlanEditor/FlowPlanEditor.utils';

interface StoredFlowUiState {
  selection?: string | null;
  collapsed?: unknown;
  search?: unknown;
  threadTicketId?: string | null;
}

const openRunKey = (boardId: string): string => `flow-open-run-${boardId}`;
const runUiKey = (runId: string): string => `flow-ui-${runId}`;

// sessionStorage throws in private-mode/quota situations; degrade to
// "nothing remembered".
const readStorage = (key: string): string | null => {
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
};

const writeStorage = (key: string, value: string): void => {
  try {
    sessionStorage.setItem(key, value);
  } catch {
    /* storage unavailable */
  }
};

const removeStorage = (key: string): void => {
  try {
    sessionStorage.removeItem(key);
  } catch {
    /* storage unavailable */
  }
};

interface UseFlowRunPersistenceArgs {
  isFlowBoard: boolean;
  layoutView: string;
  filteredSingleBoardId: string | null | undefined;
  selectedGraphRootTicketId: string | null;
  setSelectedGraphRootTicketId: (ticketId: string | null, opts?: { replace?: boolean }) => void;
  selectedFlowRunModel: FlowPlanModel | null;
  flowTickets: readonly FlowRunTicket[];
  flowSelection: FlowNodeSelection | null;
  setFlowSelection: Dispatch<SetStateAction<FlowNodeSelection | null>>;
  collapsedFlowGroups: Set<string>;
  setCollapsedFlowGroups: Dispatch<SetStateAction<Set<string>>>;
  flowRunSearchQuery: string;
  setFlowRunSearchQuery: Dispatch<SetStateAction<string>>;
  flowThreadTicket: FlowRunTicket | null;
  setFlowThreadTicket: Dispatch<SetStateAction<FlowRunTicket | null>>;
  /** Re-frames the restored selection — a remount resets the viewport to
   *  React Flow's whole-graph mount fit. */
  focusFlowNode: (nodeId: string) => void;
  /** Entry defaults' once-per-run guards — a restore claims them so "collapse
   *  all" / "auto-open the waiting step" only apply on a run's first open. */
  collapseInitRunRef: RefObject<string | null>;
  autoSelectedRunRef: RefObject<string | null>;
}

interface UseFlowRunPersistenceResult {
  /** Drops a run's remembered UI state and re-arms the entry defaults. Only
   *  for EXPLICIT open paths (the main-tickets run card) — never restores. */
  forgetRunUiState: (runId: string) => void;
}

/**
 * Persists the flow screen's state to sessionStorage and restores it on
 * revisits (URL params die with the URL) and remounts.
 *
 * Two stores, deliberately separate:
 * - `flow-open-run-<boardId>` — WHICH run is open. The URL (`?run=`) stays the
 *   primary carrier so browser back/forward work natively; this only covers
 *   fresh visits, and is removed only on a deliberate exit (back button, or
 *   browser Back seen as an in-place `?run=` removal). Automatic cleanups
 *   leave it alone — the reopen path verifies the run still exists.
 * - `flow-ui-<runId>` — HOW the run was left. sessionStorage, not
 *   history.state: the latter is clobbered by every setSearchParams write and
 *   empty on fresh visits.
 */
export function useFlowRunPersistence({
  isFlowBoard,
  layoutView,
  filteredSingleBoardId,
  selectedGraphRootTicketId,
  setSelectedGraphRootTicketId,
  selectedFlowRunModel,
  flowTickets,
  flowSelection,
  setFlowSelection,
  collapsedFlowGroups,
  setCollapsedFlowGroups,
  flowRunSearchQuery,
  setFlowRunSearchQuery,
  flowThreadTicket,
  setFlowThreadTicket,
  focusFlowNode,
  collapseInitRunRef,
  autoSelectedRunRef,
}: UseFlowRunPersistenceArgs): UseFlowRunPersistenceResult {
  // Ref, not state: must take effect within the flush it is set in.
  const uiRunRestoredRef = useRef<string | null>(null);
  // State, not ref: the save effect must only arm on a LATER render, or it
  // would serialise pre-restore values over the stored ones in the same flush.
  const [uiSaveArmedRunId, setUiSaveArmedRunId] = useState<string | null>(null);
  // The board the open run belongs to — a close must remove that board's key
  // even if the board filter changed in the same commit.
  const openRunBoardIdRef = useRef<string | null>(null);
  const previousRunIdRef = useRef<string | null>(null);
  const runSeenThisMountRef = useRef(false);

  const runExists = useCallback(
    (runId: string): boolean =>
      flowTickets.some(ticket => ticket.id === runId && isRunRoot(ticket)),
    [flowTickets],
  );

  useEffect(() => {
    uiRunRestoredRef.current = null;
    setUiSaveArmedRunId(null);
  }, [selectedGraphRootTicketId]);

  // Only remember runs confirmed to belong to THIS board: switching the board
  // filter while `?run=` survives in the URL would otherwise file the old
  // board's run under the new board.
  useEffect(() => {
    if (!isFlowBoard || !filteredSingleBoardId || !selectedGraphRootTicketId) return;
    if (!runExists(selectedGraphRootTicketId)) return;
    openRunBoardIdRef.current = filteredSingleBoardId;
    writeStorage(openRunKey(filteredSingleBoardId), selectedGraphRootTicketId);
  }, [isFlowBoard, filteredSingleBoardId, selectedGraphRootTicketId, runExists]);

  // A deliberate exit (back button / browser Back) drops `?run=` in place;
  // only it forgets the memory. An automatic cleanup (run deleted or filtered
  // out) is told apart by the run being gone from a LOADED ticket set — the
  // cleanup effects never fire while tickets are loading, so an in-place drop
  // with no tickets yet can only be the user leaving.
  useEffect(() => {
    const previousRunId = previousRunIdRef.current;
    previousRunIdRef.current = selectedGraphRootTicketId;
    if (selectedGraphRootTicketId) {
      runSeenThisMountRef.current = true;
      return;
    }
    if (!runSeenThisMountRef.current || !previousRunId) return;
    if (flowTickets.length > 0 && !runExists(previousRunId)) return;
    const boardId = openRunBoardIdRef.current ?? filteredSingleBoardId ?? null;
    if (!boardId) return;
    removeStorage(openRunKey(boardId));
    openRunBoardIdRef.current = null;
  }, [selectedGraphRootTicketId, flowTickets, runExists, filteredSingleBoardId]);

  // Reopen the remembered run on a fresh visit ONLY — once any run was shown
  // this mount, landing on the grid is a deliberate place to be (board-filter
  // round-trips, browser Back), not something to auto-reenter from. Verified
  // against the loaded tickets first — reopening a deleted or filtered-out run
  // would strand the user on an empty canvas.
  useEffect(() => {
    if (!isFlowBoard || layoutView !== 'flow' || !filteredSingleBoardId) return;
    if (selectedGraphRootTicketId || runSeenThisMountRef.current) return;
    const stored = readStorage(openRunKey(filteredSingleBoardId));
    if (!stored || !runExists(stored)) return;
    setSelectedGraphRootTicketId(stored, { replace: true });
  }, [
    isFlowBoard,
    layoutView,
    filteredSingleBoardId,
    selectedGraphRootTicketId,
    setSelectedGraphRootTicketId,
    runExists,
  ]);

  // Restore the run's UI state, claiming the entry defaults' once-per-run refs
  // first — both default effects are declared after this hook's call site and
  // wait for the same root ticket, so this always wins.
  useEffect(() => {
    if (!isFlowBoard || !selectedGraphRootTicketId || !selectedFlowRunModel) return;
    if (uiRunRestoredRef.current === selectedGraphRootTicketId) return;
    const rootTicket = flowTickets.find(ticket => ticket.id === selectedGraphRootTicketId) ?? null;
    // Tickets not loaded yet — don't consume the once-per-run slot.
    if (!rootTicket) return;
    uiRunRestoredRef.current = selectedGraphRootTicketId;
    // Armed in both paths — with nothing stored, the entry defaults become the
    // state the next render persists.
    setUiSaveArmedRunId(selectedGraphRootTicketId);

    const raw = readStorage(runUiKey(selectedGraphRootTicketId));
    let stored: StoredFlowUiState | null = null;
    try {
      stored = raw ? (JSON.parse(raw) as StoredFlowUiState) : null;
    } catch {
      stored = null;
    }
    if (!stored) return; // first open this session — entry defaults proceed
    collapseInitRunRef.current = selectedGraphRootTicketId;
    autoSelectedRunRef.current = selectedGraphRootTicketId;
    const restoredCollapsed = new Set(
      Array.isArray(stored.collapsed)
        ? stored.collapsed.filter((id): id is string => typeof id === 'string')
        : [],
    );
    setCollapsedFlowGroups(restoredCollapsed);
    setFlowRunSearchQuery(typeof stored.search === 'string' ? stored.search : '');
    const storedNode =
      stored.selection && stored.selection !== FLOW_VIRTUAL_ROOT_ID
        ? (selectedFlowRunModel.getNode(stored.selection) ?? null)
        : null;
    // A node hidden under the restored collapsed set never renders — selecting
    // it would freeze the panel snapshot and leave the focus request armed
    // until a later expand yanks the viewport.
    const planNode =
      storedNode?.groupId &&
      selectedFlowRunModel
        .groupAndAncestorIds(storedNode.groupId)
        .some(groupId => restoredCollapsed.has(groupId))
        ? null
        : storedNode;
    if (planNode) {
      const ticketsByPlanNodeId = mapPlanToRunTickets(flowTickets, selectedGraphRootTicketId);
      // skipped/skipReason refresh from the live graph via the sync effect
      setFlowSelection({
        planNode,
        ticket: ticketsByPlanNodeId.get(planNode.id) ?? null,
        skipped: false,
      });
      focusFlowNode(planNode.id);
    } else if (stored.selection === FLOW_VIRTUAL_ROOT_ID) {
      setFlowSelection({ planNode: null, ticket: rootTicket, skipped: false });
      focusFlowNode(FLOW_VIRTUAL_ROOT_ID);
    } else {
      setFlowSelection(null);
    }
    // A selection wins over a stored thread panel — the two are exclusive, and
    // restoring both would stack them for a render. conversationId mirrors the
    // open path's gate: without one the panel has no close button.
    const threadTicket =
      !planNode && !stored.selection && stored.threadTicketId
        ? (flowTickets.find(ticket => ticket.id === stored.threadTicketId) ?? null)
        : null;
    setFlowThreadTicket(threadTicket?.conversationId ? threadTicket : null);
  }, [
    isFlowBoard,
    selectedGraphRootTicketId,
    selectedFlowRunModel,
    flowTickets,
    setCollapsedFlowGroups,
    setFlowRunSearchQuery,
    setFlowThreadTicket,
    setFlowSelection,
    focusFlowNode,
    collapseInitRunRef,
    autoSelectedRunRef,
  ]);

  // Persist the run's UI state on every change once restoration has settled.
  useEffect(() => {
    const runId = selectedGraphRootTicketId;
    if (!runId || uiSaveArmedRunId !== runId) return;
    const uiState: StoredFlowUiState = {
      selection: flowSelection ? (flowSelection.planNode?.id ?? FLOW_VIRTUAL_ROOT_ID) : null,
      collapsed: [...collapsedFlowGroups],
      search: flowRunSearchQuery,
      threadTicketId: flowThreadTicket?.id ?? null,
    };
    writeStorage(runUiKey(runId), JSON.stringify(uiState));
  }, [
    collapsedFlowGroups,
    flowRunSearchQuery,
    flowSelection,
    flowThreadTicket,
    selectedGraphRootTicketId,
    uiSaveArmedRunId,
  ]);

  const forgetRunUiState = useCallback(
    (runId: string): void => {
      removeStorage(runUiKey(runId));
      // Clearing storage alone would leave the in-memory guards claimed, so a
      // same-mount re-open would keep the previous visit's groups.
      if (collapseInitRunRef.current === runId) collapseInitRunRef.current = null;
      if (autoSelectedRunRef.current === runId) autoSelectedRunRef.current = null;
      if (uiRunRestoredRef.current === runId) uiRunRestoredRef.current = null;
    },
    [collapseInitRunRef, autoSelectedRunRef],
  );

  return { forgetRunUiState };
}
