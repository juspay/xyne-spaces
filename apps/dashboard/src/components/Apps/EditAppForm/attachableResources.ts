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
    requiredPermission: 'workflows:write',
    async loadOptions(): Promise<AttachedResource[]> {
      const response = await apiInstance.get<{ workflows: SdkWorkflow[] }>(
        '/workflows-v2/workflows',
        { params: { limit: 500 } },
      );
      return response.data.workflows.map(workflow => ({
        id: workflow.id,
        name: readWorkflowName(workflow.metadata, workflow.id),
      }));
    },
  },
];
