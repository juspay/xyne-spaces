import type { ReactElement } from 'react';
import { AgentBotAvatar } from '@/components/agents/AgentBotAvatar';
import type { AgentCreateFormState } from './types';

/** What an agent's face is keyed by while it is still a draft. */
export function draftAvatarKey(form: Pick<AgentCreateFormState, 'slug' | 'name'>): string {
  return form.slug || form.name;
}

/**
 * An agent's face while it is being built: the builder body, coloured by its
 * handle or name. The canvas, its test chat and the Drafts list in Agent Hub
 * all draw it from here, so a draft looks the same everywhere.
 */
export function DraftAgentAvatar({
  form,
  size,
  busy = false,
}: {
  form: Pick<AgentCreateFormState, 'slug' | 'name'>;
  size: number;
  busy?: boolean;
}): ReactElement {
  return <AgentBotAvatar type='clover' agentKey={draftAvatarKey(form)} busy={busy} size={size} />;
}
