import type { ReleaseTrackingMode } from '@xyne/shared';
import type { ReleaseChangeInput } from '../../../components/Release/releaseChanges.utils';

export interface ReleaseServiceDraft {
  id: string;
  boardId: string;
  boardName: string;
  name: string;
  regex: string;
  ownerTeam: string;
  envPaths: string[];
  migrationPaths: string[];
  showPaths: boolean;
}

export interface ReleaseRepoDraft {
  mainBoardId: string;
  mainBoardName: string;
  channelId: string | null;
  mode: ReleaseTrackingMode;
  services: ReleaseServiceDraft[];
}

export interface SdlcReleaseRepo {
  id: string;
  name: string;
  repoUrl: string;
  host: string;
  branch: string;
  projectId: string | null;
  config: ReleaseRepoDraft | null;
}

export interface SdlcHubRepoInput {
  id: string;
  name: string;
  url: string;
  canonicalUrl?: string | null | undefined;
  baseBranch?: unknown;
}

export interface SdlcReleaseCardData {
  id: string;
  title: string;
  summary: string;
  /** Current stage, with the status that stage is configured with on its board. */
  stage: { name: string; status: string };
  date: string;
  repoName: string;
  ownerId: string;
  ownerName: string;
}

export interface ReleaseRepositoryRow {
  mainReleaseBoardId: string;
  branch: string;
  deployedCommit: string;
  newCommit: string;
}

export type RepoConfigState = 'configured' | 'notSetUp' | 'unsaved';

export interface SdlcReleasesProps {
  projectId: string | null;
  repositories: readonly SdlcHubRepoInput[];
  openReleaseId: string | null;
  onOpenRelease: (releaseId: string) => void;
  onOpenTicket: (ticketId: string) => void;
  onOpenCanvas: (canvasId: string) => void;
  onConnectRepository: () => void;
}

export interface SdlcReleaseDetailProps {
  releaseId: string;
  repos: SdlcReleaseRepo[];
  onOpenTicket: (ticketId: string) => void;
  onOpenCanvas: (canvasId: string) => void;
}

export interface SdlcReleaseBreadcrumbProps {
  releaseId: string;
  canvasId: string | null;
  onBack: () => void;
  onOpenRelease: () => void;
}

export interface SdlcReleaseThreadProps {
  releaseId: string;
  onClose: () => void;
}

export interface ReleaseTicketQa {
  artIds: string[];
  testedBy: string | null;
}

export type CodeLanguage = 'SQL' | 'TypeScript' | 'JavaScript' | 'YAML' | 'Dotenv' | 'Text';

export type CodeTone =
  | 'plain'
  | 'comment'
  | 'key'
  | 'value'
  | 'keyword'
  | 'string'
  | 'number'
  | 'method';

export interface ReleaseCodeLine {
  /** Null for a line the commit removed. */
  number: number | null;
  tokens: { text: string; tone: CodeTone }[];
}

interface ReleaseChangeCommit {
  id: string;
  ticket: string | null;
  ticketTitle: string;
  sha: string | null;
  commitUrl: string | null;
}

export interface ReleaseChangeRow {
  key: string;
  kind: 'ENV' | 'MIGRATION';
  service: string;
  title: string;
  subtitle: string;
  addedLines: number;
  removedLines: number;
  commits: ReleaseChangeCommit[];
  fileName: string;
  language: CodeLanguage;
  lines: ReleaseCodeLine[];
  source: string;
}

export interface SdlcReleaseChangesProps {
  release: { id: string; xyneId: string; metadata?: unknown };
  changes: readonly ReleaseChangeInput[];
  devTickets: readonly { xyneId: string; title: string }[];
  analysisCanvasId: string | null;
  repoName: string | null;
  onOpenCanvas: (canvasId: string) => void;
}

export interface SdlcReleaseConfigDialogProps {
  open: boolean;
  repos: SdlcReleaseRepo[];
  onClose: () => void;
  onConnectRepository: () => void;
}

export interface SdlcReleaseServicesProps {
  repoName: string;
  repoUrl: string;
  projectId: string | null;
  services: ReleaseServiceDraft[];
  onChange: (services: ReleaseServiceDraft[]) => void;
}
