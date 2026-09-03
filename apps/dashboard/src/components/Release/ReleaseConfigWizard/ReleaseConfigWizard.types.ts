import { VCSProviderType, ReleaseTrackingMode } from '@xyne/shared';
import { QueryResultType } from '@rocicorp/zero';
import { queries } from '../../../zero/queries';

export { VCSProviderType, ReleaseTrackingMode };

/** The project's applications, as synced by the parent screen. */
export type ReleaseConfigApplications = QueryResultType<typeof queries.applicationsByProjectId>;

export type ReleaseTrackingModeValue = `${ReleaseTrackingMode}`;

export type WizardStep = 1 | 2;

export interface Channel {
  id: string;
  name: string;
  type?: string;
}

/** A single application entry as edited in the form. envPaths and migrationPaths are CSV strings. */
export interface ApplicationConfig {
  id: string;
  boardId: string;
  boardName: string;
  name: string;
  repoUrl: string;
  regex: string;
  ownerTeam: string;
  /** Comma-separated — split to string[] on save */
  envPaths: string;
  /** Comma-separated — split to string[] on save */
  migrationPaths: string;
}

/** Shape of an existing persisted config passed in by the parent. */
export interface ExistingReleaseConfig {
  mainBoardId: string;
  mainBoardName: string;
  releaseTrackingMode: ReleaseTrackingMode;
  channelId: string | null;
  applications: ApplicationConfig[];
}

export type ReleaseConfigMode =
  | { kind: 'create' }
  | { kind: 'edit-main'; mainBoardId: string }
  | { kind: 'edit-application'; applicationBoardId: string }
  // Add one new service to an existing repo group — reuses the lean single-row
  // form, seeded with a blank service appended to the group's app list.
  | { kind: 'add-application'; mainBoardId: string };

export interface ReleaseConfigWizardProps {
  projectId: string;
  boardNamesById: Readonly<Record<string, string>>;
  /**
   * The project's applications, already synced by the parent. Used to resolve the
   * edited application by boardId (boardId is @unique) without a separate query.
   * `undefined` while the parent's list is still loading. Optional because the
   * inner form (which reuses these props) never needs it.
   */
  applications?: ReleaseConfigApplications | undefined;
  mode: ReleaseConfigMode;
  isOpen: boolean;
  onClose: () => void;
  /** Returns the board whose fields and stages should be edited next. */
  onSave: (targetBoard: { id: string; name: string }) => void;
}
