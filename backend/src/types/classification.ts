/**
 * Types for Email Classification feature
 */

import { TicketPriority } from '@prisma/client';

/** Raw output from AI — shape depends entirely on the channel's prompt */
export type ClassificationRawOutput = Record<string, unknown>;

/** Structured result after classification */
export interface ClassificationResult {
  category: string;           // Always filled — "Other" if nothing fits
  subCategory: string | null; // Optional
  rawOutput: ClassificationRawOutput;
}

/** Priority classification result from AI */
export interface PriorityClassificationResult {
  priority: TicketPriority;
  confidence: number;
  reasoning: string;
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

/** Extended classification data including priority */
export interface TicketClassificationDataWithPriority extends TicketClassificationData {
  priority?: TicketPriority;
  priorityConfidence?: number;
  priorityReasoning?: string;
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

/** Request body for priority preview */
export interface PriorityClassificationPreviewBody {
  emailSubject: string;
  emailBody: string;
}

/** Request body for saving priority config */
export interface SavePriorityClassificationConfigBody {
  enabled: boolean;
  priorityClassificationPrompt?: string | null;
  priorityClassificationThreshold?: number;
}
