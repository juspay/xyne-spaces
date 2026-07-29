import { ReactElement } from 'react';
import { Link, useLocation } from 'react-router-dom';

const navigationItems = [
  { path: '/', label: 'Home', icon: '🏠' },
  { path: '/chat', label: 'Chat', icon: '💬' },
  { path: '/tickets', label: 'Tickets', icon: '🎫' },
  { path: '/user-groups', label: 'User Groups', icon: '👥' },
  { path: '/agents', label: 'Agents', icon: '🤖' },
  { path: '/knowledge-base', label: 'Knowledge Base', icon: '📚' },
  { path: '/analytics', label: 'Analytics', icon: '📊' },
];

const Sidebar = (): ReactElement => {
  const location = useLocation();

  return (
    <aside className='w-64 bg-blue-600 text-white min-h-screen p-4'>
      <div className='mb-8'>
        <h1 className='text-xl font-bold text-white'>Xyne Spaces</h1>
      </div>

      <nav>
        <ul className='space-y-2'>
          {navigationItems.map(item => {
            const isActive = location.pathname === item.path;

            return (
              <li key={item.path}>
                <Link
                  to={item.path}
                  className={`flex items-center gap-3 px-4 py-3 rounded-lg transition-colors duration-200 ${
                    isActive
                      ? 'bg-blue-700 text-white'
                      : 'text-gray-100 hover:bg-blue-700 hover:text-white'
                  }`}
                >
                  <span className='text-lg'>{item.icon}</span>
                  <span className='font-medium'>{item.label}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </aside>
  );
};

export default Sidebar;
