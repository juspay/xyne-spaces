import { ReactElement } from 'react';
import { useAuth } from '../../hooks/useAuth';

const AgentsScreen = (): ReactElement => {
  const { logout } = useAuth();

  const handleLogout = (): void => {
    logout();
  };

  return (
    <div className='h-full bg-white rounded-2xl'>
      <nav className='shadow-sm border-b'>
        <div className='max-w-7xl mx-auto px-4 sm:px-6 lg:px-8'>
          <div className='flex justify-between h-16'>
            <div className='flex items-center'>
              <h1 className='text-xl font-semibold text-gray-900'>AI Agents</h1>
            </div>
            <div className='flex items-center space-x-4'>
              {/* <span className='text-sm text-gray-700'>Welcome, {user?.name || user?.email}</span> */}
              <button
                onClick={handleLogout}
                className='bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded-md text-sm font-medium transition-colors'
              >
                Logout
              </button>
            </div>
          </div>
        </div>
      </nav>

      <main className='max-w-7xl mx-auto py-6 sm:px-6 lg:px-8'>
        <div className='px-4 py-6 sm:px-0'>
          <div className='border-4 border-dashed border-gray-200 rounded-lg h-96 flex items-center justify-center'>
            <div className='text-center'>
              <h2 className='text-2xl font-bold text-gray-900 mb-4'>AI Agents</h2>
              <p className='text-gray-600 mb-8'>
                Configure and manage your AI agents and their capabilities.
              </p>
              <div className='grid grid-cols-1 md:grid-cols-3 gap-4 max-w-2xl'>
                <div className='bg-white p-6 rounded-lg shadow'>
                  <h3 className='font-semibold text-gray-900 mb-2'>Create Agent</h3>
                  <p className='text-gray-600 text-sm'>Set up a new AI agent</p>
                </div>
                <div className='bg-white p-6 rounded-lg shadow'>
                  <h3 className='font-semibold text-gray-900 mb-2'>Agent Library</h3>
                  <p className='text-gray-600 text-sm'>Browse available agents</p>
                </div>
                <div className='bg-white p-6 rounded-lg shadow'>
                  <h3 className='font-semibold text-gray-900 mb-2'>Training</h3>
                  <p className='text-gray-600 text-sm'>Train and optimize agents</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
};

export default AgentsScreen;
