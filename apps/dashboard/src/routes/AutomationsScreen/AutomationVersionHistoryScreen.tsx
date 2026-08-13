import { ReactElement } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { VersionHistory } from '../../components/Automation/AutomationVersions/VersionHistory/VersionHistory';

export default function AutomationVersionHistoryScreen(): ReactElement {
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
      <VersionHistory
        automationId={id}
        onBack={() => void navigate('..', { relative: 'path' })}
        onOpenVersion={version => void navigate(`/automations/${version.id}`)}
      />
    </div>
  );
}
