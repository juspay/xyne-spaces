import { useCallback, useEffect, useState } from 'react';

import {
  AGENT_EDITS_STATE_KEY,
  buildAgentEdits,
  emptyToolSelection,
  flattenToolSelection,
  withoutCapabilityIds,
  type AgentToolboxSelection,
} from '@/src/utils/flowAgentEditor';

export type DraftAgentEditor = {
  editable: boolean;
  selection: AgentToolboxSelection;
  modelId: string;
  providerOrder: string[];
  setToolboxSelection: (next: AgentToolboxSelection) => void;
  removeCapabilities: (ids: string[]) => void;
  setModelId: (next: string) => void;
  setProviderOrder: (next: string[]) => void;
};

type UseDraftAgentEditorInput = {
  phase?: string;
  canEditDraft: boolean;
  isSubmitting?: boolean;
  componentId: string;
  initialSelection: AgentToolboxSelection | null;
  initialModelId: string;
  initialProviderOrder: string[];
  resetKey: string;
  updateFieldValue?: (name: string, value: unknown) => void;
};

export const useDraftAgentEditor = ({
  phase,
  canEditDraft,
  isSubmitting = false,
  componentId,
  initialSelection,
  initialModelId,
  initialProviderOrder,
  resetKey,
  updateFieldValue,
}: UseDraftAgentEditorInput): DraftAgentEditor => {
  const pending = phase === 'pending';
  const editable = canEditDraft && !isSubmitting;
  const baseline = initialSelection ?? emptyToolSelection();

  const [selection, setSelection] = useState<AgentToolboxSelection>(baseline);
  const [modelId, setModel] = useState(initialModelId);
  const [providerOrder, setProviders] = useState(initialProviderOrder);

  useEffect(() => {
    setSelection(initialSelection ?? emptyToolSelection());
    setModel(initialModelId);
    setProviders(initialProviderOrder);
    // Reset only when the card identity changes, not when the parent re-parses props.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetKey, componentId]);

  const commit = useCallback(
    (next: { selection: AgentToolboxSelection; modelId: string; providerOrder: string[] }) => {
      setSelection(next.selection);
      setModel(next.modelId);
      setProviders(next.providerOrder);
      if (!editable || !updateFieldValue) return;
      updateFieldValue(AGENT_EDITS_STATE_KEY, buildAgentEdits(next));
      updateFieldValue(componentId, flattenToolSelection(next.selection));
    },
    [componentId, editable, updateFieldValue],
  );

  return {
    editable,
    selection: pending ? selection : baseline,
    modelId: pending ? modelId : initialModelId,
    providerOrder: pending ? providerOrder : initialProviderOrder,
    setToolboxSelection: next =>
      commit({
        selection: { ...next, callableAgents: selection.callableAgents },
        modelId,
        providerOrder,
      }),
    removeCapabilities: ids =>
      commit({ selection: withoutCapabilityIds(selection, ids), modelId, providerOrder }),
    setModelId: next => commit({ selection, modelId: next, providerOrder }),
    setProviderOrder: next =>
      commit({
        selection,
        modelId: next[0] === providerOrder[0] ? modelId : '',
        providerOrder: next,
      }),
  };
};
