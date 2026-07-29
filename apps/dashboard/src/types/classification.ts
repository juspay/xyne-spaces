/** Raw output from AI — shape depends entirely on the channel's prompt */
export type ClassificationRawOutput = Record<string, unknown>;

export interface UserGroupOption {
  id: string;
  name: string;
}

export interface TicketClassificationData {
  category: string;
  subCategory: string | null;
  resolvedGroupId: string | null;
  isManualOverride: boolean;
  classifiedAt: string;
  rawOutput: ClassificationRawOutput;
}

export interface ClassificationMapping {
  id: string;
  channelId: string;
  category: string;
  subCategory: string | null;
  userGroupId: string;
  createdAt: string | number;
}

export interface EmailClassificationConfig {
  channelId: string;
  enabled: boolean;
  classificationPrompt: string;
  categoryField: string;
  subCategoryField: string | null;
  mappings: ClassificationMapping[];
}

export interface SaveConfigPayload {
  classificationPrompt: string;
  enabled: boolean;
  categoryField: string;
  subCategoryField?: string | null;
}

export interface SaveMappingPayload {
  category: string;
  subCategory?: string | null;
  userGroupId: string;
}

export interface ClassificationPreviewResult {
  category: string;
  subCategory: string | null;
  resolvedGroupId: string | null;
  rawOutput: ClassificationRawOutput;
}
