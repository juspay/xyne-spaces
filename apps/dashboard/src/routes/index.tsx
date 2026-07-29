import Sidebar from '../components/Sidebar';
import { ReactElement } from 'react';
import ZeroProvider from '../providers/ZeroProvider';
import { Outlet } from 'react-router-dom';

const AppRoot = (): ReactElement => {
  return (
    <ZeroProvider>
      <div className='flex h-screen'>
        <Sidebar />
        <main className='flex-1 overflow-auto'>
          <Outlet />
        </main>
      </div>
    </ZeroProvider>
  );
};

export default AppRoot;
