import { useCallback } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import type { WorkflowApp } from '@xyne/workflow-ui';

type WorkflowAppProps = Parameters<typeof WorkflowApp>[0];

/**
 * Derived from `onNavigate` rather than restated. The package does not re-export
 * `WorkflowSearch` from its root, and hand-writing the shape drifts: it declares
 * `view?: 'graph' | 'tabs' | undefined`, and under `exactOptionalPropertyTypes` a copy
 * omitting that `| undefined` is a different, incompatible type.
 */
type WorkflowSearch = NonNullable<Parameters<WorkflowAppProps['onNavigate']>[1]>;

interface WorkflowRouting {
  /** Sub-path below the /workflows mount — '', 'w/<id>', 'runs/<id>', 'folder/<id>'… */
  path: string;
  search: WorkflowAppProps['search'];
  navigate: WorkflowAppProps['onNavigate'];
}

/**
 * Translates between react-router and the addressing `@xyne/workflow-ui` expects.
 *
 * The package owns every screen below /workflows and navigates by handing back a
 * sub-path; this is the only place that knows how such a sub-path becomes a real URL
 * here — which matters for one non-obvious reason: dashboard routes live under
 * `/:workspaceId`, so a bare `/workflows/w/123` is parsed with `workflows` as the
 * workspace segment and lands nowhere. Every path has to be re-prefixed, the same way
 * AppSidebar's `prefixWs` does.
 */
export const useWorkflowRouting = (): WorkflowRouting => {
  const params = useParams<{ workspaceId?: string; '*'?: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  const { workspaceId } = params;
  const view = searchParams.get('view');

  const go = useCallback(
    (path: string, search?: WorkflowSearch, replace?: boolean) => {
      const base = workspaceId ? `/${workspaceId}/workflows` : '/workflows';
      const query = search?.view ? `?view=${search.view}` : '';
      void navigate(`${base}/${path}${query}`, { replace: replace ?? false });
    },
    [navigate, workspaceId],
  );

  return {
    path: params['*'] ?? '',
    // Narrowed rather than passed through: `view` is whatever the address bar holds.
    search: view === 'graph' || view === 'tabs' ? { view } : {},
    navigate: go,
  };
};
