// toolsConfig — read / dirty-check / apply the toolbox selection that lives
// inside an agent's `config.tools` bag. Mirrors xyne-claw-auth's
// AgentDetailPageV3 extractToolsFromConfig / handleSaveConfig tools handling.
// Persists through updateAgent(slug, { config }); only the `tools` key is
// touched on save — everything else in config is left untouched.

import type { ToolboxSelection } from './clawToolsTypes';

type ConfigBag = Record<string, unknown> | undefined | null;

/** Fully-populated toolbox selection — every bucket always an array. */
export type ToolsDraft = Required<ToolboxSelection>;

const stringArray = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];

/** Reads the toolbox selection out of an agent's config bag. */
export function readToolsDraft(config: ConfigBag): ToolsDraft {
  const raw = config ?? {};
  const tools = raw['tools'];
  const bag =
    tools && typeof tools === 'object' && !Array.isArray(tools)
      ? (tools as Record<string, unknown>)
      : {};
  return {
    subagents: stringArray(bag['subagents']),
    direct: stringArray(bag['direct']),
    custom: stringArray(bag['custom']),
    gateway: stringArray(bag['gateway']),
  };
}

/** The empty/default draft, for initial state. */
export const EMPTY_TOOLS_DRAFT: ToolsDraft = readToolsDraft(undefined);

/** Order-independent set comparison — toolbox buckets carry no ordering. */
const sameSet = (a: string[], b: string[]): boolean => {
  if (a.length !== b.length) return false;
  const s = new Set(a);
  return b.every(v => s.has(v));
};

/** True when the draft differs from what's stored in the agent's config. */
export function toolsDirty(config: ConfigBag, draft: ToolsDraft): boolean {
  const base = readToolsDraft(config);
  return (
    !sameSet(base.subagents, draft.subagents) ||
    !sameSet(base.direct, draft.direct) ||
    !sameSet(base.custom, draft.custom) ||
    !sameSet(base.gateway, draft.gateway)
  );
}

/** Merges the toolbox draft onto the existing config. */
export function applyTools(config: ConfigBag, draft: ToolsDraft): Record<string, unknown> {
  const next: Record<string, unknown> = { ...(config ?? {}) };
  const hasAny =
    draft.subagents.length > 0 ||
    draft.direct.length > 0 ||
    draft.custom.length > 0 ||
    draft.gateway.length > 0;
  if (hasAny) {
    next['tools'] = {
      subagents: draft.subagents,
      direct: draft.direct,
      custom: draft.custom,
      gateway: draft.gateway,
    };
  } else {
    delete next['tools'];
  }
  return next;
}
