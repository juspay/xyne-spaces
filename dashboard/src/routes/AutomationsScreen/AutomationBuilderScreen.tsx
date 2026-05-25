import { ReactElement, useMemo } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { AutomationBuilder } from '../../components/Automation/AutomationBuilder/AutomationBuilder';
import { useCachedQuery } from '../../hooks/useCachedQuery';
import { useAuthContextValues } from '../../hooks/useAuth';
import { queries } from '../../zero/queries';
import {
  isAutomationWorkflow,
  workflowToAutomation,
} from '../../components/Automation/automation.adapter';

export default function AutomationBuilderScreen(): ReactElement {
  const params = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const proposalId = searchParams.get('proposal');
  const fromApprovals = searchParams.get('from') === 'approvals' || !!proposalId;
  const forkFromId = searchParams.get('fork');

  const isNew = !params.id || params.id === 'new';
  const { workspaceId } = useAuthContextValues();

  const rowIdToLoad = proposalId ?? params.id ?? '';

  const [row, rowMeta] = useCachedQuery(queries.automationById({ id: rowIdToLoad, workspaceId }), {
    enabled: !isNew,
  });
  const [forkRow, forkRowMeta] = useCachedQuery(
    queries.automationById({ id: forkFromId ?? '', workspaceId }),
    { enabled: isNew && !!forkFromId },
  );
  const automation = useMemo(
    () => (row && isAutomationWorkflow(row) ? workflowToAutomation(row) : null),
    [row],
  );
  const forkSource = useMemo(
    () => (forkRow && isAutomationWorkflow(forkRow) ? workflowToAutomation(forkRow) : null),
    [forkRow],
  );

  const isLoading =
    (!isNew && (!rowMeta || rowMeta.type !== 'complete') && !automation) ||
    (isNew && !!forkFromId && (!forkRowMeta || forkRowMeta.type !== 'complete') && !forkSource);

  if (isLoading) {
    return (
      <div className='h-full w-full bg-background md:rounded-2xl overflow-hidden shadow-md'>
        <div className='flex h-full w-full items-center justify-center text-sm text-muted-foreground'>
          <Loader2 className='mr-2 size-4 animate-spin' />
          Loading automation…
        </div>
      </div>
    );
  }

  if (!isNew && rowMeta?.type === 'complete' && !automation) {
    return (
      <div className='h-full w-full bg-background md:rounded-2xl overflow-hidden shadow-md'>
        <div className='flex h-full w-full items-center justify-center text-sm text-red-600'>
          Automation not found.
        </div>
      </div>
    );
  }

  return (
    <div className='h-full w-full bg-background md:rounded-2xl overflow-hidden shadow-md'>
      {/* `key` forces a fresh mount whenever the route's automation id (or
          fork source) changes — otherwise React reuses the same component
          and useState values like editMode / name / config carry over from
          the previous automation. */}
      <AutomationBuilder
        key={isNew ? `new-${forkFromId ?? 'fresh'}` : (params.id ?? '')}
        automation={isNew ? null : automation}
        {...(forkSource && isNew
          ? {
              initialConfig: forkSource.config,
              initialName: forkSource.name,
              ...(forkSource.description ? { initialDescription: forkSource.description } : {}),
              ...(forkSource.automationSeriesId
                ? { forkFromSeriesId: forkSource.automationSeriesId }
                : {}),
              ...(forkFromId ? { forkSourceAutomationId: forkFromId } : {}),
            }
          : {})}
        approvalReviewMode={fromApprovals}
        onBack={() => void navigate(fromApprovals ? '../approvals' : '..', { relative: 'path' })}
        onSaved={result => {
          if (isNew) {
            void navigate(`../${result.automation.id}`, { replace: true, relative: 'path' });
          }
        }}
        onShowRuns={id => void navigate(`../${id}/runs`, { relative: 'path' })}
        onAfterApprovalDecision={() => void navigate('../approvals', { relative: 'path' })}
      />
    </div>
  );
}
