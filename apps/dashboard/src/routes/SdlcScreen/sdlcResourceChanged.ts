import { queryClient } from '../../services/clients/queryClient';
import type { SdlcResourceKind } from './sdlcFrameMessages';

// Query key prefixes each kind's views read; only mounted queries refetch.
const QUERY_KEYS: Record<SdlcResourceKind, string[]> = {
  agents: ['claw-auth-agents', 'claw-subagents', 'sdlc-hub-agents'],
  // The Skills tab reads the claw skill catalog next to the hub's links.
  knowledge: ['sdlc-hub-knowledge', 'claw-skills'],
  environments: ['sdlc-environments', 'sdlc-sandbox-profiles', 'claw-sandbox-repos'],
};

export function invalidateSdlcResource(kind: SdlcResourceKind): void {
  for (const key of QUERY_KEYS[kind]) void queryClient.invalidateQueries({ queryKey: [key] });
}
