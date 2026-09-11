import { ReactElement } from 'react';
import { useNavigate } from 'react-router-dom';
import { AutomationsList } from '../../components/Automation/AutomationsList/AutomationsList';

export default function AutomationsListScreen(): ReactElement {
  const navigate = useNavigate();
  return (
    <AutomationsList
      onCreate={() => void navigate('new', { relative: 'path' })}
      onOpen={automation => void navigate(`${automation.id}`, { relative: 'path' })}
      onShowRuns={automation => void navigate(`${automation.id}/runs`, { relative: 'path' })}
    />
  );
}
