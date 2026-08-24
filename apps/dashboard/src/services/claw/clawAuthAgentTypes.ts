// Agent types mirrored from xyne-claw-auth/frontend/src/lib/types.ts so the
// dashboard renders the exact same data returned by the claw-auth backend's
// GET /claw/api/v1/agents endpoint. Keep field names in sync with that source.

export interface AgentTool {
  readonly id: string;
  readonly toolId: string;
  readonly permission: string;
  readonly tool: {
    readonly slug: string;
    readonly name: string;
    readonly source: string;
    readonly description?: string;
  };
}

export interface AgentSkill {
  readonly id: string;
  readonly skillId: string;
  readonly skill: {
    readonly slug: string;
    readonly name: string;
    readonly description: string;
    readonly content: string;
  };
}

/** Per-agent Knowledge Base grant — references a spaces Collection (and
 *  optionally a single file). fileId = null grants the whole collection. */
export interface AgentCollection {
  readonly id: string;
  readonly agentId: string;
  readonly collectionId: string;
  readonly fileId: string | null;
  readonly createdAt: string;
}

export interface AgentShare {
  readonly id: string;
  readonly userId: string;
  readonly role: string;
  readonly user: { readonly id: string; readonly name: string; readonly email: string };
}

/**
 * Patch body accepted by `PUT /claw/api/v1/agents/{slug}` (updateClawAgent).
 * Every field is optional — send only what changed. Mirrors the claw-auth
 * frontend's `updateAgent` payload. `config` is the free-form bag holding
 * tools / behaviour toggles / output-format; `systemPrompt` (+ optional
 * `promptNote`) creates a new immutable prompt version server-side.
 */
export interface UpdateAgentPayload {
  slug?: string;
  enabled?: boolean;
  name?: string;
  description?: string;
  systemPrompt?: string;
  promptNote?: string;
  color?: string;
  modelId?: string;
  config?: Record<string, unknown>;
  skills?: string[];
  knowledgeBase?: Array<{ collectionId: string; fileId?: string | null }>;
  kbScope?: 'COLLECTIONS' | 'USER';
}

/** Request kinds for `POST /agents/{slug}/request` (push to Spaces / Global). */
export type AgentRequestType = 'push_to_spaces' | 'push_to_global';

/** Contributor share roles, in ascending capability. Owner is tracked
 *  separately (Agent.ownerUserId), not as a share role. */
export type AgentShareRole = 'VIEWER' | 'CONTRIBUTOR' | 'EDITOR';

/** A claw-auth user returned by the contributor search endpoint. */
export interface ClawUser {
  readonly id: string;
  readonly name: string;
  readonly email: string;
}

/**
 * Result of `POST /agents/{slug}/clone`. Owners/contributors/admins get an
 * instant copy (`cloned: true` + the new `agent`); everyone else raises an
 * approval request routed to the owner (`cloned: false`).
 */
export interface CloneRequestItem {
  readonly id: string;
  readonly agentId?: string;
  readonly agentSlug?: string;
  readonly agentName?: string;
  readonly requestType: string;
  readonly requesterId: string;
  readonly requesterName?: string;
  readonly requesterEmail?: string;
  readonly status: string;
  readonly resultAgentId?: string | null;
  readonly createdAt: string;
}

export type CloneAgentResult =
  | { readonly cloned: true; readonly agent: Agent }
  | { readonly cloned: false; readonly request: CloneRequestItem };

export interface PromptVersion {
  readonly id: string;
  readonly agentId: string;
  readonly version: number;
  readonly systemPrompt: string;
  readonly note: string | null;
  readonly createdByUserId: string | null;
  readonly createdAt: string;
}

export interface Agent {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
  readonly description: string;
  readonly systemPrompt?: string;
  readonly activePromptVersion?: number | null;
  readonly activePromptVersionId?: string | null;
  readonly scope: string;
  readonly ownerUserId: string | null;
  readonly enabled: boolean;
  readonly isDefault?: boolean;
  readonly color: string;
  readonly modelId?: string;
  readonly config: Record<string, unknown>;
  readonly spacesAppId: string | null;
  readonly spacesAppUserId: string | null;
  readonly spacesAppToken: string | null;
  readonly spacesAppTokenConfigured?: boolean;
  readonly orgId?: string | null;
  readonly orgName?: string | null;
  readonly tools: AgentTool[];
  readonly skills?: AgentSkill[];
  readonly collections?: AgentCollection[];
  readonly kbScope?: 'COLLECTIONS' | 'USER';
  readonly shares?: AgentShare[];
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly owner?: {
    readonly id: string;
    readonly name: string;
    readonly email: string;
    readonly googleId?: string | null;
  } | null;
}
