export type ConversationSource = 'workflowSteps' | 'xyne-cli' | 'claude';

export interface MemoryIngestionContext {
  sessionId: string;
  userId: string;
  // Tenant the session belongs to; resolved server-side by the adapter, never from the payload.
  workspaceId: string;
  repoUrl: string;
  commitId: string;
  ticketId: string;
  // Full GCS URI: gs://bucket-name/path/to/file.json
  fileStoragePath: string;
}

export interface ConversationSourceAdapter {
  getItems(): Promise<unknown[]>;
  buildMemoryContext(): Promise<MemoryIngestionContext>;
}
