import { ReactElement } from 'react';
import { useParams } from 'react-router-dom';
import { AssignmentConfigScreen } from './AssignmentConfigScreen';

export const AssignmentConfigWrapper = (): ReactElement => {
  const { userGroupId } = useParams<{ userGroupId: string }>();

  if (!userGroupId) {
    return (
      <div className='flex h-full w-full items-center justify-center overflow-hidden bg-background shadow-md md:rounded-2xl'>
        <div className='px-4 text-center'>
          <h2 className='mb-2 text-base font-semibold text-foreground'>User group not found</h2>
          <p className='text-[13px] text-muted-foreground'>
            This URL has no user group ID, or the ID is not valid.
          </p>
        </div>
      </div>
    );
  }

  return <AssignmentConfigScreen userGroupId={userGroupId} />;
};
