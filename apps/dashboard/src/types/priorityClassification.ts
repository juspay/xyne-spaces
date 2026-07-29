import { TicketPriority } from '@xyne/shared';

/** Priority classification result from AI */
export interface PriorityClassificationResult {
  priority: TicketPriority;
  confidence: number;
  reasoning: string;
}

/** Configuration for priority classification */
export interface PriorityClassificationConfig {
  enabled: boolean;
  priorityClassificationPrompt: string | null;
  priorityClassificationThreshold: number;
}

/** Request body for saving priority config */
export interface SavePriorityConfigPayload {
  enabled: boolean;
  priorityClassificationPrompt?: string | null;
  priorityClassificationThreshold?: number;
}

/** Result from preview classification API */
export interface PriorityClassificationPreviewResult {
  priority: TicketPriority;
  confidence: number;
  reasoning: string;
}
