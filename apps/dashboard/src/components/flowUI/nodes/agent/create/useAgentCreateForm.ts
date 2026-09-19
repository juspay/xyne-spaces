import { useCallback, useRef, useState } from 'react';
import type { AgentCreateChatPatch, AgentCreateConflict, AgentCreateField, AgentCreateFormState } from './types';
import { EMPTY_CREATE_FORM, isFormDirty } from './types';
import { applyConflictChoice, mergeChatPatch, type FieldLock } from './mergeChatPatch';

export function useAgentCreateForm(initial: AgentCreateFormState = EMPTY_CREATE_FORM) {
  const [form, setForm] = useState<AgentCreateFormState>(initial);
  const [baseline, setBaseline] = useState<AgentCreateFormState>(initial);
  const [focused, setFocused] = useState<AgentCreateField | null>(null);
  const [dirty, setDirty] = useState<Partial<Record<AgentCreateField, boolean>>>({});
  const [conflicts, setConflicts] = useState<AgentCreateConflict[]>([]);
  const [highlights, setHighlights] = useState<ReadonlySet<AgentCreateField>>(new Set());
  const highlightTimer = useRef<number | null>(null);
  const lastSourceRef = useRef<string | null>(null);
  const focusedRef = useRef(focused);
  const dirtyRef = useRef(dirty);
  const conflictsRef = useRef(conflicts);
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

  const patchForm = useCallback((patch: Partial<AgentCreateFormState>, field?: AgentCreateField) => {
    setForm(prev => ({ ...prev, ...patch }));
    if (field) {
      setDirty(prev => ({ ...prev, [field]: true }));
    } else {
      const keys = Object.keys(patch) as Array<keyof AgentCreateFormState>;
      setDirty(prev => {
        const next = { ...prev };
        if (keys.includes('name')) next.name = true;
        if (keys.includes('slug')) next.slug = true;
        if (keys.includes('description')) next.description = true;
        if (keys.includes('systemPrompt')) next.systemPrompt = true;
        if (keys.includes('tools')) next.tools = true;
        if (keys.includes('selectedSkillIds')) next.skills = true;
        if (keys.includes('selectedKbResources') || keys.includes('selectedKbScope')) {
          next.knowledge = true;
        }
        return next;
      });
    }
  }, []);

  const applyChatPatch = useCallback(
    (sourceId: string, incoming: AgentCreateChatPatch): void => {
      if (lastSourceRef.current === sourceId) {
        return;
      }
      lastSourceRef.current = sourceId;
      setForm(current => {
        const lock: FieldLock = { focused: focusedRef.current, dirty: dirtyRef.current };
        const result = mergeChatPatch(current, incoming, lock, conflictsRef.current);
        setConflicts(result.conflicts);
        markHighlights(result.changed);
        return result.next;
      });
    },
    [markHighlights],
  );

  const resolveConflict = useCallback((field: AgentCreateField, choice: 'mine' | 'chat') => {
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
  }, [markHighlights]);

  const resetFrom = useCallback((next: AgentCreateFormState, sourceId?: string) => {
    setForm(next);
    setBaseline(next);
    setDirty({});
    setConflicts([]);
    if (sourceId) lastSourceRef.current = sourceId;
  }, []);

  const onFieldFocus = useCallback((field: AgentCreateField | null) => {
    setFocused(field);
  }, []);

  return {
    form,
    baseline,
    focused,
    dirty,
    conflicts,
    highlights,
    canvasDirty: isFormDirty(form, baseline),
    patchForm,
    applyChatPatch,
    resolveConflict,
    resetFrom,
    onFieldFocus,
    setForm,
  };
}
