import { ReactElement } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { RunDetail } from '../../components/Automation/AutomationRuns/RunDetail/RunDetail';

export default function AutomationRunDetailScreen(): ReactElement {
  const navigate = useNavigate();
  const { id, runId } = useParams<{ id: string; runId: string }>();
  if (!runId) {
    return (
      <div className='h-full w-full bg-background md:rounded-2xl overflow-hidden shadow-md'>
        <div className='flex h-full w-full items-center justify-center text-sm text-red-600'>
          Missing run id.
        </div>
      </div>
    );
  }
  return (
    <div className='h-full w-full bg-background md:rounded-2xl overflow-hidden shadow-md'>
      <RunDetail runId={runId} onBack={() => void navigate(`/automations/${id ?? ''}/runs`)} />
    </div>
  );
}
