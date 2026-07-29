export interface FSNode {
  name: string;
  type: 'file' | 'folder';
  size?: string;
  children?: FSNode[];
  meta?: string;
}

export interface FilesystemBlockProps {
  jsonSource: string;
  messageId?: string;
}

export type ViewMode = 'diagram' | 'code';
