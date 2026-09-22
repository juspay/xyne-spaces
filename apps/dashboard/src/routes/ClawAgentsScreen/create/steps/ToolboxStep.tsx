import { ReactElement } from 'react';
import { ToolboxPicker } from '@/components/ClawAgents/ToolboxPicker/ToolboxPicker';
import { useClawAvailableTools } from '@/hooks/useClawAvailableTools';
import { useClawResearchAgentOptions } from '@/hooks/useClawResearchAgentOptions';
import type { ToolboxSelection } from '@/services/claw/clawToolsTypes';
import type { WizardState } from '../wizardState';

interface Props {
  state: WizardState;
  update: (patch: Partial<WizardState>) => void;
}

export function ToolboxStep({ state, update }: Props): ReactElement {
  const { data: availableTools, isLoading } = useClawAvailableTools();
  const research = useClawResearchAgentOptions();

  return (
    <ToolboxPicker
      variant='large'
      largeHeight='clamp(420px, calc(100vh - 340px), 720px)'
      availableTools={availableTools ?? null}
      loading={isLoading}
      value={state.tools}
      onChange={(next: ToolboxSelection) =>
        update({
          tools: {
            subagents: next.subagents,
            direct: next.direct,
            custom: next.custom,
            gateway: next.gateway ?? [],
            callableAgents: state.tools.callableAgents,
          },
        })
      }
      autoSuggest
      suggestContext={{ systemPrompt: state.systemPrompt, description: state.description }}
      researchAgent={{
        productId: state.researchAgentProductId,
        onProductIdChange: v => update({ researchAgentProductId: v }),
        products: research.products,
        repositoryId: state.researchAgentRepositoryId,
        onRepositoryIdChange: v => update({ researchAgentRepositoryId: v }),
        repositories: research.repositories,
        loading: research.isLoading,
      }}
    />
  );
}
