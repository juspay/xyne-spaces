/**
 * Types for Email Classification feature
 */

/** Raw output from AI — shape depends entirely on the channel's prompt */
export type ClassificationRawOutput = Record<string, unknown>;

/** Structured result after classification */
export interface ClassificationResult {
  category: string;           // Always filled — "Other" if nothing fits
  subCategory: string | null; // Optional
  rawOutput: ClassificationRawOutput;
}

/** What gets stored on Ticket.classificationData */
export interface TicketClassificationData {
  category: string;
  subCategory: string | null;
  resolvedGroupId: string | null;
  isManualOverride: boolean;
  classifiedAt: string; // ISO string
  rawOutput: ClassificationRawOutput;
}

/** Request body for saving config */
export interface SaveClassificationConfigBody {
  classificationPrompt: string;
  enabled: boolean;
  categoryField: string;
  subCategoryField?: string | null;
}

/** Request body for creating/updating a mapping */
export interface SaveMappingBody {
  category: string;
  subCategory?: string | null;
  userGroupId: string;
}

/** Request body for preview */
export interface ClassificationPreviewBody {
  emailSubject: string;
  emailBody: string;
}
