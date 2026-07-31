export interface D2BlockProps {
  /** Raw D2-language source (d2lang.com), NOT the filesystem-tree JSON. */
  source: string;
  messageId?: string;
}

export type ViewMode = 'diagram' | 'code';
