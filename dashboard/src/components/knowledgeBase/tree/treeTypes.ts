import { NodeType, UploadStatus } from '../../../services/Knowledge/collectionService';

export interface TreeNodeData {
  id: string;
  name: string;
  type: NodeType;
  children?: TreeNodeData[];
  status?: UploadStatus;
  /** Controlled expansion state (from CollectionTreeContext) */
  isExpanded?: boolean;
  /** Whether children are currently being fetched */
  isLoading?: boolean;
}
