import { apiInstance } from '../../../services/clients/apiClient';
import type { AttachedResource } from '../../../services/Apps/appsService';

/**
 * Client half of the backend's `attachableResources` registry. `resourceType` must match
 * the backend entry — it is the URL segment. `EditAppForm` renders whatever this holds.
 */
export interface AttachableResourceConfig {
  resourceType: string;
  /** Plural, lowercase, used in the section's prose. */
  noun: string;
  /** The scope the app additionally needs to use the resource at all. */
  requiredPermission: string;
  loadOptions: () => Promise<AttachedResource[]>;
}

/** Workflow names live in the SDK's `metadata` JSON, mirroring the backend's reader. */
const readWorkflowName = (metadata: string | null, fallback: string): string => {
  if (!metadata) return fallback;
  try {
    const parsed = JSON.parse(metadata) as { name?: unknown };
    return typeof parsed.name === 'string' && parsed.name ? parsed.name : fallback;
  } catch {
    return fallback;
  }
};

interface SdkWorkflow {
  id: string;
  metadata: string | null;
}

export const ATTACHABLE_RESOURCES: AttachableResourceConfig[] = [
  {
    resourceType: 'workflows',
    noun: 'workflows',
    requiredPermission: 'workflows:start',
    async loadOptions(): Promise<AttachedResource[]> {
      // The SDK clamps a page to 100, so follow the cursor to get them all.
      const all: SdkWorkflow[] = [];
      let cursor: string | undefined;
      do {
        const response = await apiInstance.get<{
          workflows: SdkWorkflow[];
          nextCursor?: string | null;
        }>('/workflows-v2/workflows', { params: { limit: 100, ...(cursor ? { cursor } : {}) } });
        all.push(...response.data.workflows);
        cursor = response.data.nextCursor ?? undefined;
      } while (cursor);
      return all.map(workflow => ({
        id: workflow.id,
        name: readWorkflowName(workflow.metadata, workflow.id),
      }));
    },
  },
];
