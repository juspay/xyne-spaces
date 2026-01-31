import { ReactElement } from 'react';
import { useParams } from 'react-router-dom';
import { AssignmentConfigScreen } from './AssignmentConfigScreen';

export const AssignmentConfigWrapper = (): ReactElement => {
  const { userGroupId } = useParams<{ userGroupId: string }>();

  if (!userGroupId) {
    return (
      <div className='h-full w-full flex items-center justify-center bg-gray-50'>
        <div className='text-center'>
          <h2 className='text-2xl font-semibold text-gray-900 mb-2'>User Group Not Found</h2>
          <p className='text-gray-600'>The user group ID is missing or invalid.</p>
        </div>
      </div>
    );
  }

  return <AssignmentConfigScreen userGroupId={userGroupId} />;
};
