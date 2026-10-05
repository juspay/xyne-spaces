import type { ReactElement } from 'react';
import { AgentPromptVersions } from './AgentPromptVersions';
import { CredentialsCard } from './credentials/CredentialsCard';
import { ModelCard } from './model/ModelCard';
import { PersonalHarnessSection } from './model/PersonalHarnessSection';
import type { AgentConfigTarget } from '../settings/agentConfigTarget';

/**
 * Persona settings. Description and instructions are edited on the profile
 * itself; this holds what sits behind them: prompt versions, model, my own
 * harness override, keys. An agent that isn't saved yet has only the model.
 */
export function AgentPersonaTabV2({
  target,
  canEdit,
  saved,
}: {
  target: AgentConfigTarget;
  canEdit: boolean;
  saved?: {
    slug: string;
    canManageCredentials: boolean;
    onPromptRestored: (systemPrompt: string) => void;
  };
}): ReactElement {
  return (
    <div className='flex w-full flex-col gap-8'>
      {saved?.canManageCredentials && (
        <AgentPromptVersions
          agentSlug={saved.slug}
          canRestore={canEdit}
          onRestored={saved.onPromptRestored}
        />
      )}

      <ModelCard target={target} canEdit={canEdit} />

      {saved && <PersonalHarnessSection agentSlug={saved.slug} />}

      {saved && (
        <CredentialsCard
          slug={saved.slug}
          canRead={canEdit}
          canManage={saved.canManageCredentials}
        />
      )}
    </div>
  );
}
