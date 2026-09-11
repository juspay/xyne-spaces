import { ReactElement } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { RunHistory } from '../../components/Automation/AutomationRuns/RunHistory/RunHistory';

export default function AutomationRunsScreen(): ReactElement {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  if (!id) {
    return (
      <div className='flex h-full w-full items-center justify-center text-sm text-red-600'>
        Missing automation id.
      </div>
    );
  }
  return (
    <RunHistory
      automationId={id}
      onBack={() => void navigate('..', { relative: 'path' })}
      onOpenRun={run => void navigate(`${run.id}`, { relative: 'path' })}
    />
  );
}
