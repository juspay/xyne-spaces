/** Where a saved agent keeps the face it was built with. */
export const AVATAR_KEY_CONFIG = 'avatarKey';

/**
 * The key an agent's face is drawn from. A new agent keeps the one its draft
 * had (saved on its config when it was created), so the face it was built
 * with is the face it keeps, through a rename too. Older agents use their id.
 */
export function agentAvatarKey(agent: {
  id: string;
  config?: Readonly<Record<string, unknown>> | null | undefined;
}): string {
  const key = agent.config?.[AVATAR_KEY_CONFIG];
  return typeof key === 'string' && key ? key : agent.id;
}
