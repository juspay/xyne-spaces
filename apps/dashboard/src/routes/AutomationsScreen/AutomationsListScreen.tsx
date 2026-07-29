import { ReactElement } from 'react';
import { useNavigate } from 'react-router-dom';
import { AutomationsList } from '../../components/Automation/AutomationsList/AutomationsList';

export default function AutomationsListScreen(): ReactElement {
  const navigate = useNavigate();
  return (
    <div className='h-full w-full bg-background md:rounded-2xl overflow-hidden shadow-md'>
      <AutomationsList
        onCreate={() => void navigate('/automations/new')}
        onOpen={automation => void navigate(`/automations/${automation.id}`)}
        onShowRuns={automation => void navigate(`/automations/${automation.id}/runs`)}
      />
    </div>
  );
}
