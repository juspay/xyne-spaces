import { useCallback, useEffect, useRef, useState } from 'react';
import { fieldSave, stageMove, type FieldMapping, type FieldRow, type FieldValueRow, type PanelStage, type PanelTransition, type StageEtaEntry, type StageOption } from './ticketPanel';
import { spaces } from './xyne';

/**
 * Loads one ticket for the Desk-style panel (details, board stages and transitions, custom fields,
 * labels, people, groups, types) and runs each edit through the Spaces SDK, then reloads. The SDK is
 * request/response, not live like the dashboard's Zero, so every write is followed by a refetch.
 */

export interface TagMapping {
  id: string;
  tagId: string;
  tagName: string;
}

export interface DetailTicket {
  id: string;
  xyneId: string;
  title: string;
  description: string;
  statusV2: string;
  priority: string;
  stageName: string;
  boardId: string;
  projectId: string;
  channelId: string;
  userGroupId: string | null;
  assignedTo: string | null;
  createdBy: string;
  createdAt: number;
  ticketType: string | null;
  merchantId: string | null;
  eta: number | null;
  tagMappings?: TagMapping[];
  stageEtaEntries?: StageEtaEntry[];
  project?: { name?: string } | null;
}

export interface PanelState {
  ticket: DetailTicket;
  stages: PanelStage[];
  transitions: PanelTransition[];
  nonLinear: boolean;
  boardName: string | null;
  mapping: FieldMapping | null;
  values: FieldValueRow[];
  types: string[];
  tags: { id: string; name: string }[];
  groups: { id: string; name: string }[];
}

// Workspace-wide lists and per-board config change rarely; keep them for the session.
const cache = new Map<string, Promise<unknown>>();
export function once<T>(key: string, load: () => Promise<T>): Promise<T> {
  let p = cache.get(key) as Promise<T> | undefined;
  if (!p) {
    p = load();
    cache.set(key, p);
    p.catch(() => cache.delete(key));
  }
  return p;
}

async function loadState(ticketId: string): Promise<PanelState> {
  const ticket = (await spaces.tickets.getDetails(ticketId)) as unknown as DetailTicket | null;
  if (!ticket) throw new Error('This ticket is no longer available.');
  const b = ticket.boardId;
  const [stages, transitions, board, mapping, values, types, tags, groups] = await Promise.all([
    once(`stages:${b}`, () => spaces.boards.listStages(b)),
    once(`transitions:${b}`, () => spaces.boards.listTransitions(b)),
    once(`board:${b}`, () => spaces.boards.getDetail(b)),
    once(`mapping:${b}`, () => spaces.forms.getMapping(b, 'BOARD', 'TICKET')),
    spaces.forms.listValues(ticketId),
    once('types', () => spaces.workspace.listLookupValues('TICKET_TYPE')),
    once(`tags:${ticket.projectId}`, () => spaces.tickets.listProjectTags(ticket.projectId)),
    once('groups', () => spaces.userGroups.list()),
  ]);
  const boardInfo = board as unknown as { name?: string; boardType?: string } | null;
  return {
    ticket,
    stages: stages as unknown as PanelStage[],
    transitions: transitions as unknown as PanelTransition[],
    nonLinear: boardInfo?.boardType === 'NON_LINEAR',
    boardName: boardInfo?.name ?? null,
    mapping: mapping as unknown as FieldMapping | null,
    values: values as unknown as FieldValueRow[],
    types: types.map(t => t.value),
    tags: tags.map(t => ({ id: t.id, name: t.name })),
    groups: groups.filter(g => g.isActive).map(g => ({ id: g.id, name: g.name })),
  };
}

const message = (e: unknown): string => (e instanceof Error && e.message ? e.message : 'Something went wrong');

/** A fresh id for a stage-ETA row the ticket doesn't have yet (the SDK doesn't mint it). */
const newId = (): string => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`);

export function useTicketPanel(ticketId: string, onSaved: (text: string) => void, onError: (text: string) => void) {
  const [state, setState] = useState<PanelState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const live = useRef(ticketId);
  live.current = ticketId;

  const load = useCallback(async (): Promise<void> => {
    const id = ticketId;
    try {
      const s = await loadState(id);
      if (live.current === id) {
        setState(s);
        setError(null);
      }
    } catch (e) {
      if (live.current === id) setError(message(e));
    }
  }, [ticketId]);

  useEffect(() => {
    setState(null);
    setError(null);
    void load();
  }, [load]);

  /** Run one write, then reload; the server's message is shown if it refuses. */
  const write = useCallback(
    async (label: string, run: () => Promise<unknown>): Promise<boolean> => {
      setSaving(true);
      try {
        await run();
        await load();
        onSaved(label);
        return true;
      } catch (e) {
        onError(message(e));
        await load();
        return false;
      } finally {
        setSaving(false);
      }
    },
    [load, onSaved, onError],
  );

  const t = state?.ticket;
  const actions = {
    title: (title: string) => t && write('Title updated', () => spaces.tickets.update(t.id, { title })),
    description: (description: string) => t && write('Description updated', () => spaces.tickets.update(t.id, { description })),
    stage: (opt: StageOption) => {
      if (!t || !state) return;
      const stage = state.stages.find(s => s.id === opt.id);
      if (!stage) return;
      const move = stageMove(stage, state.nonLinear);
      return write(`Moved to ${stage.name}`, () =>
        move.kind === 'update'
          ? spaces.tickets.update(t.id, move.data as { stageName: string; statusV2: 'TODO' | 'STARTED' | 'PAUSED' | 'CANCELLED' | 'COMPLETED' })
          : spaces.tickets.transitionStage(t.id, move.toStageName),
      );
    },
    // The SDK types these as non-null, but the server accepts null to clear them.
    assignee: (userId: string | null) => t && write(userId ? 'Assignee updated' : 'Unassigned', () => spaces.tickets.update(t.id, { assignedTo: userId as string })),
    priority: (priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL') => t && write('Priority updated', () => spaces.tickets.update(t.id, { priority })),
    eta: (eta: number) => t && write('Ticket ETA updated', () => spaces.tickets.update(t.id, { eta })),
    stageEta: (eta: number, entryId: string | null, stageId: string) =>
      t && write('Stage ETA updated', () => spaces.tickets.setStageEta(entryId ?? newId(), eta, { ticketId: t.id, stageId })),
    addLabel: (name: string) => t && write(`Label ${name} added`, () => spaces.tickets.addTag(t.id, t.projectId, name)),
    removeLabel: (m: TagMapping) => t && write(`Label ${m.tagName} removed`, () => spaces.tickets.removeTag(m.id, m.id)),
    type: (ticketType: string) => t && write('Type updated', () => spaces.tickets.update(t.id, { ticketType })),
    group: (groupId: string | null) => t && write('User group updated', () => spaces.tickets.update(t.id, { userGroupId: groupId as string })),
    field: (row: FieldRow, values: string[]) => {
      if (!t) return;
      const save = fieldSave(row, values, t.id, t.boardId);
      return write(`${row.name} updated`, () => (save.kind === 'update' ? spaces.forms.updateValue(save.id, save.newValue) : spaces.forms.createValue(save.data)));
    },
  };

  return { state, error, saving, reload: load, actions };
}
