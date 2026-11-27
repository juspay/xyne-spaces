import { isAgentInvocableBy } from "xyne-claw-shared";
import { startRunInProcess } from "../../lib/start-run.js";
import { createLogger } from "../../logger.js";
import type { SpacesAuthContext } from "../../mcp/servers/xyne-spaces-client.js";
import type { SpacesActor } from "./identity.js";
import { rejectIdentityFields, stripIdentityFields } from "./schema.js";

const log = createLogger("spaces-dispatch");

export interface SpacesDispatchInput {
  actor: SpacesActor;
  agent: { slug: string; config: unknown };
  conversationId: string;
  body: Record<string, unknown>;
  resolveSpacesAuth?: ((userId: string) => Promise<SpacesAuthContext | undefined>) | undefined;
}

export type SpacesDispatchResult =
  | { ok: true; sessionId: string }
  | { ok: false; status: number; error: string };

export function authorizeSpacesRun(input: {
  actor: SpacesActor;
  agent: { slug: string; config: unknown };
}): { ok: true } | { ok: false; status: number; error: string } {
  if (!isAgentInvocableBy(input.agent.config as Record<string, unknown> | null, input.actor.userId)) {
    log.warn(`[spaces-dispatch] invocation denied (not whitelisted) slug=${input.agent.slug} userId=${input.actor.userId}`);
    return {
      ok: false,
      status: 403,
      error: `agent "${input.agent.slug}" is restricted — you don't have access to it`,
    };
  }
  return { ok: true };
}

export async function dispatchSpacesRun(input: SpacesDispatchInput): Promise<SpacesDispatchResult> {
  const authorized = authorizeSpacesRun({ actor: input.actor, agent: input.agent });
  if (!authorized.ok) return authorized;

  const rejected = rejectIdentityFields(input.body);
  if (!rejected.ok) {
    log.warn(`[spaces-dispatch] refused dispatch body carrying identity fields: ${rejected.offending.join(", ")}`);
    return { ok: false, status: rejected.status, error: rejected.error };
  }

  const started = await startRunInProcess(
    {
      body: stripIdentityFields(input.body),
      isInternalRun: true,
      isInternalS2SCaller: true,
      wantsSse: false,
      authenticatedUserId: input.actor.userId,
      headerOrgId: input.actor.orgId,
      ...(input.resolveSpacesAuth ? { resolveSpacesAuth: input.resolveSpacesAuth } : {}),
    },
    {},
  );
  if (!started.ok) {
    return { ok: false, status: started.status, error: started.error };
  }
  return { ok: true, sessionId: started.sessionId };
}
