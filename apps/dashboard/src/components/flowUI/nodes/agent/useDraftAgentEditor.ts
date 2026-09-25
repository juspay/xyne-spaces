import { useState } from 'react';
import type { AgentDraftProps } from '@xyne/shared';
import type { AgentToolboxSelection, ToolboxSelection } from '@/services/claw/clawToolsTypes';
import { useFlow } from '../../FlowContext';

const EDITS_STATE_KEY = 'agent-edits';

export interface DraftAgentEditor {
  editable: boolean;
  selection: AgentToolboxSelection;
  modelId: string;
  providerOrder: string[];
  setToolboxSelection: (next: Required<ToolboxSelection>) => void;
  removeCapabilities: (ids: string[]) => void;
  setModelId: (next: string) => void;
  setProviderOrder: (next: string[]) => void;
}

function selectionFromProps(props: AgentDraftProps): AgentToolboxSelection {
  const stored = props.toolSelection ?? {};
  return {
    subagents: stored.subagents ?? [],
    direct: stored.direct ?? [],
    custom: stored.custom ?? [],
    gateway: stored.gateway ?? [],
    callableAgents: stored.callableAgents ?? [],
  };
}

function flatten(selection: AgentToolboxSelection): string[] {
  return [
    ...selection.subagents,
    ...selection.direct,
    ...selection.custom,
    ...selection.gateway,
    ...selection.callableAgents,
  ];
}

function withoutIds(selection: AgentToolboxSelection, ids: string[]): AgentToolboxSelection {
  const dropped = new Set(ids);
  const keep = (bucket: string[]): string[] => bucket.filter(entry => !dropped.has(entry));
  return {
    subagents: keep(selection.subagents),
    direct: keep(selection.direct),
    custom: keep(selection.custom),
    gateway: keep(selection.gateway),
    callableAgents: keep(selection.callableAgents),
  };
}

export function useDraftAgentEditor(props: AgentDraftProps, componentId: string): DraftAgentEditor {
  const { state, updateFieldValue } = useFlow();
  const pending = props.phase === 'pending';
  const editable = pending && !state.submitting && props.toolSelection !== undefined;

  const [selection, setSelection] = useState<AgentToolboxSelection>(() =>
    selectionFromProps(props),
  );
  const [modelId, setModel] = useState<string>(props.agent.modelId ?? '');
  const [providerOrder, setProviders] = useState<string[]>(props.agent.providerOrder ?? []);

  const commit = (next: {
    selection: AgentToolboxSelection;
    modelId: string;
    providerOrder: string[];
  }): void => {
    setSelection(next.selection);
    setModel(next.modelId);
    setProviders(next.providerOrder);
    updateFieldValue(EDITS_STATE_KEY, {
      toolSelection: next.selection,
      modelId: next.modelId,
      providerOrder: next.providerOrder,
    });
    updateFieldValue(componentId, flatten(next.selection));
  };

  return {
    editable,
    selection: pending ? selection : selectionFromProps(props),
    modelId: pending ? modelId : (props.agent.modelId ?? ''),
    providerOrder: pending ? providerOrder : (props.agent.providerOrder ?? []),
    setToolboxSelection: (next): void =>
      commit({
        selection: { ...next, callableAgents: selection.callableAgents },
        modelId,
        providerOrder,
      }),
    removeCapabilities: (ids): void =>
      commit({ selection: withoutIds(selection, ids), modelId, providerOrder }),
    setModelId: (next): void => commit({ selection, modelId: next, providerOrder }),
    setProviderOrder: (next): void =>
      commit({
        selection,
        modelId: next[0] === providerOrder[0] ? modelId : '',
        providerOrder: next,
      }),
  };
}
