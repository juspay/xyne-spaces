import { NodeType } from '../../../services/Knowledge/collectionService';
import { IngestionStatus } from '@xyne/shared';

export interface TreeNodeData {
  id: string;
  name: string;
  type: NodeType;
  children?: TreeNodeData[];
  status?: IngestionStatus | null;
  isExpanded?: boolean;
  isLoading?: boolean;
}

export type SortField = 'name' | 'date' | 'size';
export type SortOrder = 'asc' | 'desc';

export interface SortOption {
  field: SortField;
  order: SortOrder;
}

export interface CollectionTreeNode {
  id: string;
  name: string;
  type: NodeType;
  parentId: string | null;
  uploadStatus: IngestionStatus | null;
  size: number;
  updatedAt: string;
  mimeType: string;
  childrenIds: string[];
  isLoaded: boolean;
  isLoading: boolean;
}
