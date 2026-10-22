import { useCallback, useMemo, useState } from 'react';

import { lotusStorage } from '@/src/services/localStorage';

import { DEFAULT_AGENT_SLUG, type XyneAIAgent, type XyneAIModel } from '../api/xyneAICatalog';
import type { ThinkingLevel, XyneAIStreamRequest } from '../api/xyneAIRequest';
import { useXyneAIAgents, useXyneAIConfig, useXyneAIModels } from './useXyneAICatalog';

const AGENT_SLUG_KEY = 'lotus.xyneAI.agentSlug';

const readStoredAgentSlug = (): string | undefined => lotusStorage.getString(AGENT_SLUG_KEY);

function writeStoredAgentSlug(slug: string | undefined): void {
  if (slug === undefined) lotusStorage.remove(AGENT_SLUG_KEY);
  else lotusStorage.set(AGENT_SLUG_KEY, slug);
}

export type XyneAIRequestOptions = Omit<XyneAIStreamRequest, 'query' | 'sessionId'>;

export interface XyneAISelection {
  agents: XyneAIAgent[];
  /** `undefined` is the default Ask AI agent. */
  agent: XyneAIAgent | undefined;
  agentSlug: string | undefined;
  models: XyneAIModel[];
  defaultModelName: string | undefined;
  /** `undefined` lets the agent pick its recommended model. */
  model: string | undefined;
  thinkingLevel: ThinkingLevel | undefined;
  modes: { webSearch: ModeState; deepResearch: ModeState };
  /** Whether the agent list has loaded or failed, so a chosen agent is known to exist. */
  isReady: boolean;
  requestOptions: XyneAIRequestOptions;
  selectAgent: (slug: string | undefined) => void;
  selectModel: (model: string | undefined) => void;
  selectThinkingLevel: (level: ThinkingLevel | undefined) => void;
}

export interface ModeState {
  accessible: boolean;
  enabled: boolean;
  toggle: () => void;
}

const NONE: never[] = [];

export function useXyneAISelection(): XyneAISelection {
  const [storedSlug, setStoredSlug] = useState(readStoredAgentSlug);
  const [model, setModel] = useState<string>();
  const [thinkingLevel, setThinkingLevel] = useState<ThinkingLevel>();
  const [webSearch, setWebSearch] = useState(false);
  const [deepResearch, setDeepResearch] = useState(false);

  const { data: agents, isPending: isAgentsPending } = useXyneAIAgents();
  const agent = agents?.find(candidate => candidate.slug === storedSlug);
  // An agent removed since it was chosen would fail every message.
  const agentSlug = agents && !agent ? undefined : storedSlug;

  const { data: catalog } = useXyneAIModels(agentSlug ?? DEFAULT_AGENT_SLUG);
  const { data: config } = useXyneAIConfig();
  const webSearchAccessible = config?.webSearchAccessible ?? false;
  const deepResearchAccessible = config?.deepResearchAccessible ?? false;
  const webSearchEnabled = webSearchAccessible && webSearch;
  const deepResearchEnabled = deepResearchAccessible && deepResearch;

  const selectAgent = useCallback((slug: string | undefined): void => {
    writeStoredAgentSlug(slug);
    setStoredSlug(slug);
    setModel(undefined);
    setThinkingLevel(undefined);
  }, []);

  const requestOptions = useMemo(
    () => ({
      agentSlug,
      model,
      modelProvider: catalog?.pinProvider,
      thinkingLevel,
      instant: agent?.instantAgent,
      webSearchEnabled,
      deepResearchEnabled,
    }),
    [
      agentSlug,
      model,
      catalog?.pinProvider,
      thinkingLevel,
      agent?.instantAgent,
      webSearchEnabled,
      deepResearchEnabled,
    ],
  );

  return {
    agents: agents ?? NONE,
    agent,
    agentSlug,
    models: catalog?.models ?? NONE,
    defaultModelName: catalog?.defaultModelName,
    model,
    thinkingLevel,
    isReady: !isAgentsPending,
    modes: {
      webSearch: {
        accessible: webSearchAccessible,
        enabled: webSearchEnabled,
        toggle: (): void => setWebSearch(on => !on),
      },
      deepResearch: {
        accessible: deepResearchAccessible,
        enabled: deepResearchEnabled,
        toggle: (): void => setDeepResearch(on => !on),
      },
    },
    requestOptions,
    selectAgent,
    selectModel: setModel,
    selectThinkingLevel: setThinkingLevel,
  };
}
