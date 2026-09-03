import type { QueryVisualizationType } from '@xyne/shared';

export interface ChartBlockProps {
  jsonSource: string;
  messageId?: string;
}

export interface ChartBlockPayload {
  title: string;
  /** Narrowed at the parse boundary — guaranteed to have a renderer. */
  visualType: QueryVisualizationType;
  data: unknown;
}
