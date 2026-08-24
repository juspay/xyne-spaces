import { ReactElement } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { RunDetail } from '../../components/Automation/AutomationRuns/RunDetail/RunDetail';

export default function AutomationRunDetailScreen(): ReactElement {
  const navigate = useNavigate();
  const { id: _id, runId } = useParams<{ id: string; runId: string }>();
  if (!runId) {
    return (
      <div className='flex h-full w-full items-center justify-center text-sm text-red-600'>
        Missing run id.
      </div>
    );
  }
  return <RunDetail runId={runId} onBack={() => void navigate('..', { relative: 'path' })} />;
}
