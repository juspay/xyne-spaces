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

export interface SdlcRepositoryHub {
  id: string;
  name: string;
  url: string;
  canonicalUrl: string;
  projectId: string;
  channelId: string;
}

export interface SdlcRepositoryRunContext {
  repoId: string;
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
  /** Update parked as suggestions for human review — the canvas is unchanged. */
  parked?: boolean;
  pendingChanges?: number;
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
  attachRepository(actor: SdlcActor, input: AttachSdlcRepositoryInput): Promise<SdlcRepositoryHub>;
  setupRepository(actor: SdlcActor, repoId: string): Promise<SdlcSetupExecution>;
  refreshSetup(actor: SdlcActor, repoId: string): Promise<SdlcSetupExecution>;
  retrySetup(actor: SdlcActor, repoId: string): Promise<SdlcSetupExecution>;
  cancelSetup(actor: SdlcActor, repoId: string): Promise<SdlcSetupExecution>;
  listRepositoryRunContexts(
    actor: SdlcActor,
    query?: string,
    limit?: number
  ): Promise<SdlcRepositoryRunContext[]>;
  getRepositoryRunContext(
    actor: SdlcActor,
    repoId: string,
    conversationId: string
  ): Promise<SdlcRepositoryRunContext>;
  createArtifactFromClaw(
    actor: SdlcActor,
    input: CreateSdlcClawArtifactInput
  ): Promise<SdlcArtifact>;
  updateBaselineDraftFromClaw(
    actor: SdlcActor,
    input: UpdateSdlcBaselineDraftInput
  ): Promise<SdlcArtifact>;
  listTracks(actor: SdlcActor, repoId: string): Promise<unknown>;
  createTrack(actor: SdlcActor, input: CreateSdlcTrackInput): Promise<unknown>;
  linkContext(actor: SdlcActor, repoId: string, input: CreateSdlcLinkInput): Promise<SdlcLink>;
  unlinkContext(actor: SdlcActor, repoId: string, linkId: string): Promise<void>;
}
