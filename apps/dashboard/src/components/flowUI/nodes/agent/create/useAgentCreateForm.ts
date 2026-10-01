import { useCallback, useRef, useState } from 'react';
import type {
  AgentCreateChatPatch,
  AgentCreateConflict,
  AgentCreateField,
  AgentCreateFormState,
  AgentCreateHubRow,
} from './types';
import { EMPTY_CREATE_FORM, isFormDirty } from './types';
import { applyConflictChoice, mergeChatPatch, type FieldLock } from './mergeChatPatch';
import { sanitizeAgentCanvasName } from './canvasFromIdentity.ts';

/**
 * The field the user is typing in, if the page still has focus inside it. A blur
 * can go unheard (dev overlays capture focus events), and a stale lock would turn
 * a change the user asked chat for into a conflict.
 */
function stillFocused(field: AgentCreateField | null): AgentCreateField | null {
  if (!field || typeof document === 'undefined') return field;
  const host = document.activeElement?.closest('[data-create-field]');
  return host?.getAttribute('data-create-field') === field ? field : null;
}

export function useAgentCreateForm(initial: AgentCreateFormState = EMPTY_CREATE_FORM) {
  const [form, setForm] = useState<AgentCreateFormState>(initial);
  const [baseline, setBaseline] = useState<AgentCreateFormState>(initial);
  const [focused, setFocused] = useState<AgentCreateField | null>(null);
  const [dirty, setDirty] = useState<Partial<Record<AgentCreateField, boolean>>>({});
  const [conflicts, setConflicts] = useState<AgentCreateConflict[]>([]);
  const [highlights, setHighlights] = useState<ReadonlySet<AgentCreateField>>(new Set());
  const [writingField, setWritingFieldState] = useState<AgentCreateField | null>(null);
  const [writingHubRow, setWritingHubRowState] = useState<AgentCreateHubRow | null>(null);
  const [attentionField, setAttentionFieldState] = useState<AgentCreateField | null>(null);
  const [attentionHubRow, setAttentionHubRowState] = useState<AgentCreateHubRow | null>(null);
  const highlightTimer = useRef<number | null>(null);
  const lastSourceRef = useRef<string | null>(null);
  const formRef = useRef(form);
  const focusedRef = useRef(focused);
  const dirtyRef = useRef(dirty);
  const conflictsRef = useRef(conflicts);
  formRef.current = form;
  focusedRef.current = focused;
  dirtyRef.current = dirty;
  conflictsRef.current = conflicts;

  const markHighlights = useCallback((changed: AgentCreateField[]) => {
    if (changed.length === 0) return;
    setHighlights(new Set(changed));
    if (highlightTimer.current !== null) {
      window.clearTimeout(highlightTimer.current);
    }
    highlightTimer.current = window.setTimeout(() => {
      setHighlights(new Set());
      highlightTimer.current = null;
    }, 1400);
  }, []);

  const clearHighlights = useCallback(() => {
    if (highlightTimer.current !== null) {
      window.clearTimeout(highlightTimer.current);
      highlightTimer.current = null;
    }
    setHighlights(new Set());
    setWritingFieldState(null);
    setWritingHubRowState(null);
    setAttentionFieldState(null);
    setAttentionHubRowState(null);
  }, []);

  const clearHighlightMarks = useCallback(() => {
    if (highlightTimer.current !== null) {
      window.clearTimeout(highlightTimer.current);
      highlightTimer.current = null;
    }
    setHighlights(new Set());
  }, []);

  const setAttentionField = useCallback(
    (field: AgentCreateField | null, hubRow: AgentCreateHubRow | null = null) => {
      setAttentionFieldState(field);
      setAttentionHubRowState(field ? hubRow : null);
    },
    [],
  );

  const setWritingField = useCallback(
    (field: AgentCreateField | null, hubRow: AgentCreateHubRow | null = null) => {
      if (highlightTimer.current !== null) {
        window.clearTimeout(highlightTimer.current);
        highlightTimer.current = null;
      }
      setWritingFieldState(field);
      setWritingHubRowState(field ? hubRow : null);
      if (field) {
        setAttentionFieldState(field);
        setAttentionHubRowState(hubRow);
      }
      setHighlights(field ? new Set([field]) : new Set());
    },
    [],
  );

  const patchForm = useCallback(
    (patch: Partial<AgentCreateFormState>, field?: AgentCreateField) => {
      const normalized =
        typeof patch.name === 'string'
          ? { ...patch, name: sanitizeAgentCanvasName(patch.name) }
          : patch;
      setForm(prev => {
        const next = { ...prev, ...normalized };
        formRef.current = next;
        return next;
      });
      setDirty(prev => {
        const next = { ...prev };
        if (field) {
          next[field] = true;
        } else {
          const keys = Object.keys(patch) as Array<keyof AgentCreateFormState>;
          if (keys.includes('name')) next.name = true;
          if (keys.includes('slug')) next.slug = true;
          if (keys.includes('description')) next.description = true;
          if (keys.includes('systemPrompt')) next.systemPrompt = true;
          if (keys.includes('tools')) next.tools = true;
          if (keys.includes('selectedSkillIds')) next.skills = true;
          if (keys.includes('selectedKbResources') || keys.includes('selectedKbScope')) {
            next.knowledge = true;
          }
          if (keys.includes('schedule')) next.schedule = true;
          if (keys.includes('customProperties')) next.properties = true;
        }
        dirtyRef.current = next;
        return next;
      });
    },
    [],
  );

  const applyChatPatch = useCallback(
    (
      sourceId: string,
      incoming: AgentCreateChatPatch,
      /**
       * `overrideEdits`: the user asked chat for this change, so it lands over
       * fields they edited by hand, which then hold chat's text. The field they
       * are typing in stays theirs.
       */
      options?: { highlight?: boolean; overrideEdits?: boolean },
    ): AgentCreateField[] => {
      if (lastSourceRef.current === sourceId) {
        return [];
      }
      lastSourceRef.current = sourceId;
      const lock: FieldLock = {
        focused: stillFocused(focusedRef.current),
        dirty: options?.overrideEdits ? {} : dirtyRef.current,
      };
      const result = mergeChatPatch(formRef.current, incoming, lock, conflictsRef.current);
      formRef.current = result.next;
      setForm(result.next);
      setConflicts(result.conflicts);
      conflictsRef.current = result.conflicts;
      if (options?.overrideEdits && result.changed.some(field => dirtyRef.current[field])) {
        const next = { ...dirtyRef.current };
        for (const field of result.changed) delete next[field];
        dirtyRef.current = next;
        setDirty(next);
      }
      if (options?.highlight !== false) {
        markHighlights(result.changed);
      }
      return result.changed;
    },
    [markHighlights],
  );

  const resolveConflict = useCallback(
    (field: AgentCreateField, choice: 'mine' | 'chat') => {
      setConflicts(prev => {
        const match = prev.find(conflict => conflict.field === field);
        if (!match) return prev;
        if (choice === 'chat') {
          setForm(current => applyConflictChoice(current, match, 'chat'));
          markHighlights([field]);
          setDirty(currentDirty => ({ ...currentDirty, [field]: false }));
        }
        return prev.filter(conflict => conflict.field !== field);
      });
    },
    [markHighlights],
  );

  const resetFrom = useCallback((next: AgentCreateFormState, sourceId?: string) => {
    setForm(next);
    formRef.current = next;
    setBaseline(next);
    setDirty({});
    setConflicts([]);
    setHighlights(new Set());
    setWritingFieldState(null);
    setWritingHubRowState(null);
    setAttentionFieldState(null);
    setAttentionHubRowState(null);
    if (sourceId) lastSourceRef.current = sourceId;
  }, []);

  /**
   * Load a stored draft. The baseline stays put, so the canvas still counts as
   * unsaved, and no field is marked user-owned, so chat can keep editing it.
   */
  const restore = useCallback((next: AgentCreateFormState) => {
    setForm(next);
    formRef.current = next;
    setDirty({});
    dirtyRef.current = {};
    setConflicts([]);
    conflictsRef.current = [];
  }, []);

  const onFieldFocus = useCallback((field: AgentCreateField | null) => {
    focusedRef.current = field;
    setFocused(field);
  }, []);

  return {
    form,
    baseline,
    focused,
    dirty,
    conflicts,
    highlights,
    writingField,
    writingHubRow,
    attentionField,
    attentionHubRow,
    canvasDirty: isFormDirty(form, baseline),
    getForm: () => formRef.current,
    patchForm,
    applyChatPatch,
    resolveConflict,
    resetFrom,
    restore,
    onFieldFocus,
    setForm,
    markHighlights,
    clearHighlights,
    clearHighlightMarks,
    setWritingField,
    setAttentionField,
  };
}
