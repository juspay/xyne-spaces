// Claw agent runs started from inside an artifact app, served by claw-auth at
// `/claw/api/v1/artifact-app-agents`. Uses `clawRequest` for the same reason
// artifactAppsService does: the rows live in claw-auth's database, and there is
// no Spaces-side record to proxy.
//
// Dispatch is deliberately NOT a streaming call. `startArtifactAppAgentRun`
// returns as soon as the run is accepted; the run itself continues server-side
// whether or not anyone is watching. Progress is read separately, off the live
// conversation stream, so closing the app cannot cancel work.

import { clawRequest } from './clawRequest';

const BASE = '/api/v1/artifact-app-agents';

export type ArtifactAppAgentRunStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled';

/** An agent the viewer may drive from this app. */
export interface ArtifactAppAgent {
  slug: string;
  name: string;
  description: string;
  color: string;
}

export interface ArtifactAppAgentRun {
  id: string;
  sessionId: string | null;
  /** What the live stream attaches to. Stable per (app, viewer, runKey). */
  conversationId: string;
  agentSlug: string;
  runKey: string;
  prompt: string;
  status: ArtifactAppAgentRunStatus;
  /** The final answer. Null until the run completes. */
  output: string | null;
  error: string | null;
  toolInvocations: unknown;
  currentToolLabel: string | null;
  completedAt: string | null;
  createdAt: string;
}

/** Identifies the app: its saved id once saved, its attachment before that. */
export interface ArtifactAppRef {
  appId?: string | undefined;
  attachmentId?: string | undefined;
}

function refQuery(ref: ArtifactAppRef): string {
  const params = new URLSearchParams();
  if (ref.appId) params.set('appId', ref.appId);
  else if (ref.attachmentId) params.set('attachmentId', ref.attachmentId);
  return params.toString();
}

/**
 * Agents this viewer can drive from this app — already intersected server-side
 * with anything the app declared, so the result is directly renderable as a
 * picker. An empty list means the viewer has access to none of them, which is a
 * normal outcome for a published app pinned to the author's personal agent.
 */
export async function listArtifactAppAgents(
  ref: ArtifactAppRef,
): Promise<{ agents: ArtifactAppAgent[]; declared: string[] }> {
  return clawRequest(`${BASE}/agents?${refQuery(ref)}`);
}

/**
 * Start a run. Resolves once claw has accepted it — NOT when it finishes.
 *
 * `key` names the conversation: repeat calls on one key continue that thread, so
 * the agent keeps its context across turns. Only one run per key may be in
 * flight; a second returns 409.
 */
export async function startArtifactAppAgentRun(
  input: ArtifactAppRef & {
    prompt: string;
    agentSlug?: string | undefined;
    key?: string | undefined;
  },
): Promise<{ run: ArtifactAppAgentRun }> {
  return clawRequest(`${BASE}/runs`, { method: 'POST', body: JSON.stringify(input) });
}

/**
 * This viewer's runs for an app, newest first. This is the resync read: an app
 * reopened an hour later finds its earlier work here without having stored
 * anything client-side.
 */
export async function listArtifactAppAgentRuns(
  ref: ArtifactAppRef,
  key?: string,
): Promise<{ runs: ArtifactAppAgentRun[] }> {
  const q = refQuery(ref);
  return clawRequest(`${BASE}/runs?${q}${key ? `&key=${encodeURIComponent(key)}` : ''}`);
}

export async function getArtifactAppAgentRun(runId: string): Promise<{ run: ArtifactAppAgentRun }> {
  return clawRequest(`${BASE}/runs/${encodeURIComponent(runId)}`);
}

export async function cancelArtifactAppAgentRun(runId: string): Promise<{ status: string }> {
  return clawRequest(`${BASE}/runs/${encodeURIComponent(runId)}/cancel`, { method: 'POST' });
}
