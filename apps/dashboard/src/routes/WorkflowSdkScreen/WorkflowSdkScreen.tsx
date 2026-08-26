// The v2 workflow engine UI (@xyne/workflow-ui) rendered at
// /:workspaceId/workflow-studio/*. The whole app (builder canvas, execution viewer,
// credential vault) ships inside WorkflowApp — this screen only bridges
// routing, auth headers, and toasts. Distinct from the legacy
// AutomationsScreen at /:workspaceId/automations.

import type { JSX } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { WorkflowUIProvider, WorkflowApp, createWorkflowClient } from '@xyne/workflow-ui';
import { API_BASE_URL } from '@/config';
import '@xyne/workflow-ui/styles.css';
// Must follow the package stylesheet — supplies `--wui-*` tokens it references
// but never defines (see the file header).
import './workflow-ui-vars.css';

// Same derivation as apiClient.ts: the first path segment is the workspace id.
// The backend uses it to resolve the workspace-scoped auth cookie.
const getWorkspaceIdFromPath = (): string | undefined =>
  window.location.pathname.match(/^\/([^/]+)/)?.[1];

// Module-level singleton — the client is stateless; cookies carry auth
// (credentials: 'include', mirroring the axios client's withCredentials).
const workflowClient = createWorkflowClient({
  baseUrl: `${API_BASE_URL}/workflow-studio`,
  getHeaders: () => {
    const workspaceId = getWorkspaceIdFromPath();
    return workspaceId && workspaceId !== 'auth' ? { 'x-workspace-id': workspaceId } : {};
  },
  // createWorkflowClient's option is typed as a fetch function, so axios
  // cannot satisfy it.
  // eslint-disable-next-line local-rules/no-fetch-use-axios
  fetch: (input, init) => fetch(input, { ...init, credentials: 'include' }),
});

export default function WorkflowSdkScreen(): JSX.Element {
  const params = useParams<{ workspaceId?: string; '*'?: string }>();
  const splat = params['*'] ?? '';
  const workspaceId = params.workspaceId;
  const location = useLocation();
  const navigate = useNavigate();

  const rawView = new URLSearchParams(location.search).get('view');
  const view = rawView === 'graph' || rawView === 'tabs' ? rawView : undefined;

  // Height plumbing for @xyne/workflow-ui 1.3.30 — two quirks to work around:
  //  1. WorkflowApp ignores its `className` prop (destructured, never applied),
  //     so sizing must come from around it.
  //  2. WorkflowUIProvider wraps children in a bare `div[data-workflow-ui]`
  //     with no height, which breaks the chain: WorkflowApp's own `h-full`
  //     would resolve against an auto-height parent and collapse to content.
  // The arbitrary variant below gives that intermediate div a real height.
  return (
    <div
      className='relative h-full w-full overflow-hidden [&>[data-workflow-ui]]:h-full'
      data-component='WorkflowSdkScreen'
    >
      <WorkflowUIProvider client={workflowClient}>
        <WorkflowApp
          path={splat}
          search={{ view }}
          onNavigate={(path, search, replace) => {
            const base = workspaceId ? `/${workspaceId}/workflow-studio` : '/workflow-studio';
            const pathname = path ? `${base}/${path}` : base;
            const query = search?.view ? `?view=${search.view}` : '';
            void navigate(`${pathname}${query}`, { replace: replace ?? false });
          }}
          onToast={(kind, message) =>
            kind === 'success' ? toast.success(message) : toast.error(message)
          }
        />
      </WorkflowUIProvider>
    </div>
  );
}
