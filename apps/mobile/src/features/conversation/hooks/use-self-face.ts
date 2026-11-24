import { useMemo } from 'react';

import { useAuth } from '@/src/contexts/AuthContext';

/** The signed-in user, as a face needs them: who to draw as yourself, and the name for the initials. */
export type SelfFace = { id: string; name: string };

/** Lets faces outside a message row (bubbles, the toast) draw you as the room does. */
export function useSelfFace(): SelfFace | null {
  const { user } = useAuth();
  const id = user?.user_id;
  const name = user?.name ?? '';
  return useMemo(() => (id ? { id, name } : null), [id, name]);
}
