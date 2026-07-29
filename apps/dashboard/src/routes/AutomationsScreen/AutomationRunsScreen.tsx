import { ReactElement } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { RunHistory } from '../../components/Automation/AutomationRuns/RunHistory/RunHistory';

export default function AutomationRunsScreen(): ReactElement {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  if (!id) {
    return (
      <div className='h-full w-full bg-background md:rounded-2xl overflow-hidden shadow-md'>
        <div className='flex h-full w-full items-center justify-center text-sm text-red-600'>
          Missing automation id.
        </div>
      </div>
    );
  }
  return (
    <div className='h-full w-full bg-background md:rounded-2xl overflow-hidden shadow-md'>
      <RunHistory
        automationId={id}
        onBack={() => void navigate(`/automations/${id}`)}
        onOpenRun={run => void navigate(`/automations/${id}/runs/${run.id}`)}
      />
    </div>
  );
}
