import { ReactElement } from 'react';
import { useParams } from 'react-router-dom';
import { AssignmentConfigScreen } from './AssignmentConfigScreen';

export const AssignmentConfigWrapper = (): ReactElement => {
  const { userGroupId } = useParams<{ userGroupId: string }>();

  if (!userGroupId) {
    return (
      <div className='h-full w-full flex items-center justify-center bg-muted'>
        <div className='text-center'>
          <h2 className='text-2xl font-semibold text-foreground mb-2'>User Group Not Found</h2>
          <p className='text-muted-foreground'>The user group ID is missing or invalid.</p>
        </div>
      </div>
    );
  }

  return <AssignmentConfigScreen userGroupId={userGroupId} />;
};
