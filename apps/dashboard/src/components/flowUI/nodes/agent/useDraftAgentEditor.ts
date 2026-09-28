import { useState } from 'react';
import type { AgentDraftProps } from '@xyne/shared';
import type { AgentToolboxSelection, ToolboxSelection } from '@/services/claw/clawToolsTypes';
import { useFlow } from '../../FlowContext';

const EDITS_STATE_KEY = 'agent-edits';

/** Mirrors isValidAgentSlug in xyne-claw-auth — reject here, not on approve. */
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MAX_SLUG = 80;
const MAX_NAME = 100;

export interface DraftIdentityFields {
  name: string;
  slug: string;
  description: string;
  systemPrompt: string;
}

export interface DraftAgentEditor {
  editable: boolean;
  selection: AgentToolboxSelection;
  modelId: string;
  providerOrder: string[];
  setToolboxSelection: (next: Required<ToolboxSelection>) => void;
  removeCapabilities: (ids: string[]) => void;
  setModelId: (next: string) => void;
  setProviderOrder: (next: string[]) => void;
  /** Identity as it will be created — the saved edit, or what was drafted. */
  identity: DraftIdentityFields;
  editingIdentity: boolean;
  /** Live buffer while the form is open; equals `identity` when it is not. */
  identityDraft: DraftIdentityFields;
  identityError: string | null;
  /** Which identity input takes focus when the form opens. */
  identityFocus: 'name' | 'slug' | null;
  startIdentityEdit: (field?: 'name' | 'slug') => void;
  cancelIdentityEdit: () => void;
  setIdentityField: (field: keyof DraftIdentityFields, value: string) => void;
  saveIdentity: () => void;
}

function identityFromProps(props: AgentDraftProps): DraftIdentityFields {
  return {
    name: props.agent.name,
    slug: props.agent.slug,
    description: props.agent.description ?? '',
    systemPrompt: props.agent.systemPrompt ?? '',
  };
}

function identityError(fields: DraftIdentityFields): string | null {
  if (fields.name.trim().length === 0) return 'The agent needs a name.';
  if (fields.name.trim().length > MAX_NAME) return `Keep the name under ${MAX_NAME} characters.`;
  const slug = fields.slug.trim();
  if (slug.length === 0) return 'The agent needs an identifier.';
  if (slug.length > MAX_SLUG) return `Keep the identifier under ${MAX_SLUG} characters.`;
  if (!SLUG_RE.test(slug)) {
    return 'Identifiers use lowercase letters, numbers and single hyphens.';
  }
  if (fields.systemPrompt.trim().length === 0) return 'The agent needs a system prompt.';
  return null;
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
  const [identity, setIdentity] = useState<DraftIdentityFields>(() => identityFromProps(props));
  const [identityDraft, setIdentityDraft] = useState<DraftIdentityFields>(identity);
  const [editingIdentity, setEditingIdentity] = useState(false);
  const [showError, setShowError] = useState(false);
  const [identityFocus, setIdentityFocus] = useState<'name' | 'slug' | null>(null);

  const commit = (next: {
    selection: AgentToolboxSelection;
    modelId: string;
    providerOrder: string[];
    identity: DraftIdentityFields;
  }): void => {
    setSelection(next.selection);
    setModel(next.modelId);
    setProviders(next.providerOrder);
    setIdentity(next.identity);
    updateFieldValue(EDITS_STATE_KEY, {
      toolSelection: next.selection,
      modelId: next.modelId,
      providerOrder: next.providerOrder,
      name: next.identity.name.trim(),
      slug: next.identity.slug.trim(),
      description: next.identity.description.trim(),
      systemPrompt: next.identity.systemPrompt.trim(),
    });
    updateFieldValue(componentId, flatten(next.selection));
  };

  const effectiveIdentity = pending ? identity : identityFromProps(props);
  const error = identityError(identityDraft);

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
        identity,
      }),
    removeCapabilities: (ids): void =>
      commit({ selection: withoutIds(selection, ids), modelId, providerOrder, identity }),
    setModelId: (next): void => commit({ selection, modelId: next, providerOrder, identity }),
    setProviderOrder: (next): void =>
      commit({
        selection,
        modelId: next[0] === providerOrder[0] ? modelId : '',
        providerOrder: next,
        identity,
      }),
    identity: effectiveIdentity,
    editingIdentity,
    identityDraft: editingIdentity ? identityDraft : effectiveIdentity,
    identityError: showError ? error : null,
    identityFocus,
    startIdentityEdit: (field): void => {
      setIdentityDraft(identity);
      setShowError(false);
      setIdentityFocus(field ?? null);
      setEditingIdentity(true);
    },
    cancelIdentityEdit: (): void => {
      setIdentityDraft(identity);
      setShowError(false);
      setIdentityFocus(null);
      setEditingIdentity(false);
    },
    setIdentityField: (field, value): void => {
      setIdentityDraft(current => ({ ...current, [field]: value }));
      setShowError(false);
    },
    saveIdentity: (): void => {
      if (error) {
        setShowError(true);
        return;
      }
      const trimmed: DraftIdentityFields = {
        name: identityDraft.name.trim(),
        slug: identityDraft.slug.trim(),
        description: identityDraft.description.trim(),
        systemPrompt: identityDraft.systemPrompt.trim(),
      };
      commit({ selection, modelId, providerOrder, identity: trimmed });
      setIdentityDraft(trimmed);
      setIdentityFocus(null);
      setEditingIdentity(false);
    },
  };
}
