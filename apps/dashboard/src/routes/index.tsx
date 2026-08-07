import Sidebar from '../components/Sidebar';
import { ReactElement } from 'react';
import ZeroProvider from '../providers/ZeroProvider';
import { EncryptionBootstrapProvider } from '../providers/EncryptionBootstrapProvider';
import { Outlet } from 'react-router-dom';

const AppRoot = (): ReactElement => {
  return (
    <EncryptionBootstrapProvider>
      <ZeroProvider>
        <div className='flex h-screen'>
          <Sidebar />
          <main className='flex-1 overflow-auto'>
            <Outlet />
          </main>
        </div>
      </ZeroProvider>
    </EncryptionBootstrapProvider>
  );
};

export default AppRoot;
