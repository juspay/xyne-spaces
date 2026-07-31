export interface ReleaseReportMetadata {
  ticketId: string;
  xyneId: string;
  title: string;
  version: string | null;
  status: string;
  projectId: string;
  projectName: string;
  workspaceId: string;
  channelId: string;
  conversationId: string;
  createdAt: string;
  generatedAt: string;
}

export interface ReleaseReportDevTicket {
  ticketId: string;
  title: string;
  devOwner: string;
  type: string;
  status: string;
  changes: string;
  qaOwner: string;
  prUrl: string | null;
}

export interface ReleaseReportChange {
  id: string;
  applicationName: string;
  repositoryUrl: string | null;
  filePath: string;
  devTicketId: string | null;
  commitId: string | null;
  description: string;
  oldValue: string;
  newValue: string;
  changeLog: string;
  createdAt: string;
}

export interface ReleaseReport {
  release: ReleaseReportMetadata;
  summary: {
    devTicketCount: number;
    environmentVariableCount: number;
    migrationFileCount: number;
  };
  devTickets: ReleaseReportDevTicket[];
  environmentChanges: ReleaseReportChange[];
  migrations: ReleaseReportChange[];
}

export type ReleaseReportPublicationAction = "created" | "updated";

export interface PublishReleaseReportResponse {
  success: boolean;
  partialFailure: boolean;
  action: ReleaseReportPublicationAction;
  canvasUrl: string;
  version: number;
  warning?: string;
  error?: string;
}
