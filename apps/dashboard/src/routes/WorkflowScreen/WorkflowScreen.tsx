import { type ReactElement, useCallback, useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { WorkflowApp, WorkflowUIProvider } from '@xyne/workflow-ui';
import { toast } from 'sonner';
import { workflowClient } from '../../lib/workflowClient';
import { queryClient } from '../../services/clients/queryClient';
import { xyneAIActor, type WorkflowInfo } from '../../machines/xyneAIMachine';
import { Button } from '../../components/ui/Button';
import Tooltip from '../../components/ui/Tooltip';
import { XyneAIStar } from '../../components/icons/xyne-ai';
import { useWorkflowRouting } from './useWorkflowRouting';

const notify = (kind: 'success' | 'error', message: string): void => {
  if (kind === 'success') toast.success(message);
  else toast.error(message);
};

const scopeFromPath = (path: string): { workflowId?: string; executionId?: string } => {
  const [segment, id] = path.split('/');
  if (!id) return {};
  if (segment === 'w') return { workflowId: id };
  if (segment === 'runs') return { executionId: id };
  return {};
};

const nameFromMetadata = (metadata: string | null): string | null => {
  if (!metadata) return null;
  try {
    const parsed: unknown = JSON.parse(metadata);
    const name = (parsed as { name?: unknown })?.name;
    return typeof name === 'string' && name ? name : null;
  } catch {
    return null;
  }
};

const WorkflowScreen = (): ReactElement => {
  const { path, search, navigate } = useWorkflowRouting();
  const scope = useMemo(() => scopeFromPath(path), [path]);
  const askAiTooltip = scope.executionId
    ? 'Ask AI about this run'
    : scope.workflowId
      ? 'Ask AI about this workflow'
      : 'Ask AI';

  const { data: workflowInfo = null } = useQuery<WorkflowInfo | null>({
    queryKey: ['askai-workflow-scope', scope.workflowId ?? null, scope.executionId ?? null],
    enabled: Boolean(scope.workflowId || scope.executionId),
    staleTime: 60_000,
    queryFn: async (): Promise<WorkflowInfo | null> => {
      if (scope.executionId) {
        const detail = await workflowClient.executions.get(scope.executionId);
        return {
          workflowId: detail.workflowId,
          title: detail.name ?? null,
          executionId: scope.executionId,
        };
      }
      if (!scope.workflowId) return null;
      const record = await workflowClient.workflows.get(scope.workflowId);
      return { workflowId: scope.workflowId, title: nameFromMetadata(record.metadata) };
    },
  });

  const [selectedStepId, setSelectedStepId] = useState<string | null>(null);
  useEffect(() => {
    setSelectedStepId(null);
  }, [scope.workflowId, scope.executionId]);

  const currentScope = useMemo((): WorkflowInfo | null => {
    const base =
      workflowInfo ??
      (scope.workflowId
        ? { workflowId: scope.workflowId }
        : scope.executionId
          ? { executionId: scope.executionId }
          : null);
    if (!base) return null;
    return { ...base, ...(selectedStepId ? { stepId: selectedStepId } : {}) };
  }, [workflowInfo, scope.workflowId, scope.executionId, selectedStepId]);

  useEffect(() => {
    xyneAIActor.send({ type: 'SET_WORKFLOW_CONTEXT', workflowInfo: currentScope });
  }, [currentScope]);

  useEffect(() => {
    return () => {
      xyneAIActor.send({ type: 'SET_WORKFLOW_CONTEXT', workflowInfo: null });
    };
  }, []);

  const openAskAi = useCallback((): void => {
    xyneAIActor.send({ type: 'OPEN', workflowInfo: currentScope });
  }, [currentScope]);

  const askAiButton = (
    <Tooltip content={askAiTooltip} side='bottom'>
      <Button
        variant='ghost'
        size='sm'
        aria-label={askAiTooltip}
        onClick={openAskAi}
        className='h-8 w-8 rounded-lg p-0'
        data-track-category='WORKFLOWS'
        data-track-name='OPEN_XYNE_AI'
        data-track-metadata={JSON.stringify(scope)}
      >
        <XyneAIStar />
      </Button>
    </Tooltip>
  );

  return (
    <div className='h-full overflow-hidden rounded-2xl border border-border bg-background'>
      <WorkflowUIProvider client={workflowClient} queryClient={queryClient} className='h-full'>
        <WorkflowApp
          className='xyne-workflow-ui h-full'
          path={path}
          search={search}
          onNavigate={navigate}
          onToast={notify}
          headerActions={askAiButton}
          onSelectStep={setSelectedStepId}
        />
      </WorkflowUIProvider>
    </div>
  );
};

export default WorkflowScreen;
