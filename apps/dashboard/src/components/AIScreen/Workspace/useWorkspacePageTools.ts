import { useEffect } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { isElectronApp } from '../../../utils/electronApp';
import { executePageTool } from './workspaceBrowserTools';
import { executeAppTool, isAppControlTool, registerAppControlHost } from './appControlTools';

export function useWorkspacePageTools(): void {
  const navigate = useNavigate();
  const location = useLocation();
  const { workspaceId } = useParams<{ workspaceId?: string }>();

  useEffect(() => {
    registerAppControlHost({
      navigate: path => {
        void navigate(path);
      },
      currentPath: () => location.pathname,
      workspaceId: () => workspaceId ?? location.pathname.split('/').filter(Boolean)[0] ?? '',
    });
    return () => registerAppControlHost(null);
  }, [navigate, location.pathname, workspaceId]);

  useEffect(() => {
    if (!isElectronApp()) return undefined;
    const harness = window.electronAPI?.localHarness;
    if (!harness?.onPageToolRequest || !harness.sendPageToolResult) return undefined;

    const reply = harness.sendPageToolResult.bind(harness);
    const unsubscribe = harness.onPageToolRequest(req => {
      if (!req || typeof req.id !== 'string') return;
      const run = isAppControlTool(req.toolName)
        ? executeAppTool(req.toolName, req.args ?? {})
        : executePageTool(req.toolName, req.args ?? {});
      void run
        .then(result => reply(req.id, result))
        .catch(() => reply(req.id, { ok: false, content: 'Tool failed' }));
    });

    return () => {
      unsubscribe();
    };
  }, []);
}
