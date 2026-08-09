import type {
  AttachSdlcRepositoryInput,
  CreateSdlcArtifactInput,
  CreateSdlcClawArtifactInput,
  CreateSdlcLinkInput,
  CreateSdlcTicketInput,
  StartSdlcWorkInput,
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
  boardId: string;
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
  kind: 'BASELINE' | 'PRD' | 'TECH_DOC';
  viewAccessId?: string;
  url?: string;
  executionId?: string;
  conversationId?: string;
}

export interface SdlcLink {
  id: string;
  sourceType: string;
  sourceId: string;
  targetType: string;
  targetId: string;
  relationType: string;
}

export interface ApprovedSdlcBaseline {
  canvasId: string;
  knowledgeDocumentId: string;
  allBaselinesApproved: boolean;
}

export interface SdlcWorkExecution {
  ticketId: string;
  workflowExecutionId: string;
}

export interface SdlcTicket {
  ticketId: string;
}

export interface SdlcHub {
  attachRepository(actor: SdlcActor, input: AttachSdlcRepositoryInput): Promise<SdlcRepositoryHub>;
  setupRepository(actor: SdlcActor, repoId: string): Promise<SdlcSetupExecution>;
  retrySetup(actor: SdlcActor, repoId: string): Promise<SdlcSetupExecution>;
  cancelSetup(actor: SdlcActor, repoId: string): Promise<SdlcSetupExecution>;
  restartSetup(actor: SdlcActor, repoId: string): Promise<SdlcSetupExecution>;
  listRepositoryRunContexts(
    actor: SdlcActor,
    query?: string,
    limit?: number
  ): Promise<SdlcRepositoryRunContext[]>;
  getRepositoryRunContext(
    actor: SdlcActor,
    repoId: string,
    conversationId: string,
  ): Promise<SdlcRepositoryRunContext>;
  createArtifact(
    actor: SdlcActor,
    repoId: string,
    input: CreateSdlcArtifactInput
  ): Promise<SdlcArtifact>;
  createArtifactFromClaw(
    actor: SdlcActor,
    input: CreateSdlcClawArtifactInput
  ): Promise<SdlcArtifact>;
  updateBaselineDraftFromClaw(
    actor: SdlcActor,
    input: UpdateSdlcBaselineDraftInput
  ): Promise<SdlcArtifact>;
  createTicket(actor: SdlcActor, repoId: string, input: CreateSdlcTicketInput): Promise<SdlcTicket>;
  linkContext(actor: SdlcActor, repoId: string, input: CreateSdlcLinkInput): Promise<SdlcLink>;
  unlinkContext(actor: SdlcActor, repoId: string, linkId: string): Promise<void>;
  approveBaseline(
    actor: SdlcActor,
    repoId: string,
    canvasId: string
  ): Promise<ApprovedSdlcBaseline>;
  startWork(
    actor: SdlcActor,
    repoId: string,
    input: StartSdlcWorkInput
  ): Promise<SdlcWorkExecution>;
}
