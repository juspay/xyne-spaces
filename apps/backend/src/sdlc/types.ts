import type {
  AttachSdlcRepositoryInput,
  CreateSdlcClawArtifactInput,
  CreateSdlcLinkInput,
  CreateSdlcTrackInput,
  UpdateSdlcBaselineDraftInput,
} from '@xyne/shared';
import type { SdlcAgentContext } from './SdlcAgentContextService';

export interface SdlcActor {
  userId: string;
  workspaceId: string;
  isApp?: boolean;
}

/** A registered repository. Membership lives in sdlc_entity_links, not here. */
export interface SdlcRepository {
  id: string;
  name: string;
  url: string;
  canonicalUrl: string;
  projectId: string;
}

/** An SDLC hub: the private channel plus the repositories it covers. */
export interface SdlcChannel {
  id: string;
  name: string;
  projectId: string;
  repoIds: string[];
}

export interface SdlcRepositoryRunContext {
  repoId: string;
  channelId: string;
  name: string;
  url: string;
  baseBranch: string;
  agentContext?: SdlcAgentContext;
}

export interface SdlcSetupExecution {
  executionId: string;
  status: string;
}

export interface SdlcArtifact {
  canvasId?: string;
  kind?: 'BASELINE';
  viewAccessId?: string;
  url?: string;
}

export interface SdlcLink {
  id: string;
  sourceType: string;
  sourceId: string;
  targetType: string;
  targetId: string;
  relationType: string;
}

export interface SdlcHub {
  createRepository(actor: SdlcActor, input: AttachSdlcRepositoryInput): Promise<SdlcRepository>;
  setupRepository(actor: SdlcActor, repoId: string): Promise<SdlcSetupExecution>;
  refreshSetup(actor: SdlcActor, repoId: string): Promise<SdlcSetupExecution>;
  retrySetup(actor: SdlcActor, repoId: string): Promise<SdlcSetupExecution>;
  cancelSetup(actor: SdlcActor, repoId: string): Promise<SdlcSetupExecution>;
  listRepositoryRunContexts(
    actor: SdlcActor,
    query?: string,
    limit?: number,
    channelId?: string
  ): Promise<SdlcRepositoryRunContext[]>;
  getRepositoryRunContext(
    actor: SdlcActor,
    repoId: string,
    conversationId: string,
    channelId?: string
  ): Promise<SdlcRepositoryRunContext>;
  createArtifactFromClaw(
    actor: SdlcActor,
    input: CreateSdlcClawArtifactInput
  ): Promise<SdlcArtifact>;
  updateBaselineDraftFromClaw(
    actor: SdlcActor,
    input: UpdateSdlcBaselineDraftInput
  ): Promise<SdlcArtifact>;
  listTracks(actor: SdlcActor, channelId: string): Promise<unknown>;
  createTrack(actor: SdlcActor, input: CreateSdlcTrackInput): Promise<unknown>;
  linkContext(
    actor: SdlcActor,
    repoId: string | null,
    input: CreateSdlcLinkInput,
    channelId?: string
  ): Promise<SdlcLink>;
  unlinkContext(actor: SdlcActor, repoId: string, linkId: string): Promise<void>;
}
