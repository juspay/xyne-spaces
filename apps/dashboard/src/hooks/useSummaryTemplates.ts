import { useMemo } from 'react';
import { queries } from '../zero/queries';
import { useQuery } from './useQuery';
import { useSelf } from './useUsers';
import type {
  SummaryTemplate,
  SummaryTemplateSection,
} from '../services/Recording/recordingService';

interface UseSummaryTemplatesResult {
  templates: SummaryTemplate[];
  isLoading: boolean;
}

export function useSummaryTemplates(enabled: boolean): UseSummaryTemplatesResult {
  const currentUser = useSelf();
  // Use the live query result here without the app-level persisted query cache.
  // That cache is keyed by the custom query name and args, so it can retain an
  // older authorization result when the server-side visibility predicate changes.
  const [rows, details] = useQuery(queries.summaryTemplates({}), { enabled });
  const templates = useMemo<SummaryTemplate[]>(
    () =>
      rows.map(row => ({
        id: row.id,
        workspaceId: row.workspaceId,
        name: row.name,
        autoTriggerPrompt: row.autoTriggerPrompt ?? null,
        sections: row.sections as unknown as SummaryTemplateSection[],
        version: row.version,
        systemPrompt: row.systemPrompt,
        defaultOutlet: row.defaultOutlet as SummaryTemplate['defaultOutlet'],
        createdBy: row.createdBy,
        createdAt: new Date(row.createdAt).toISOString(),
        visibility: row.visibility as SummaryTemplate['visibility'],
        canEdit: row.createdBy === currentUser?.id,
        isSystem: false,
      })),
    [currentUser?.id, rows],
  );

  return {
    templates,
    isLoading: enabled && details.type !== 'complete' && rows.length === 0,
  };
}

export default useSummaryTemplates;
