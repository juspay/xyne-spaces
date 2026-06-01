import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import { Toaster } from 'sonner';
import { ExternalLobbyPage } from './routes/ExternalLobby/ExternalLobbyPage';

/**
 * dashboard-external router.
 *
 * Only serves the external call join flow:
 *   /call/:callId  →  ExternalLobbyPage (pre-join lobby + in-call view)
 *
 * No ZeroProvider, no AuthProvider, no workspace routing shim — this app is
 * deployed on a public domain accessible without VPN.
 */
const router = createBrowserRouter([
  {
    path: '/call/:callId',
    element: <ExternalLobbyPage />,
  },
  {
    path: '*',
    element: (
      <div className="min-h-screen bg-gradient-to-br from-gray-900 to-gray-950 flex items-center justify-center p-4">
        <div className="text-center">
          <p className="text-gray-400 text-sm">Page not found.</p>
          <p className="text-gray-600 text-xs mt-2">
            To join a call, use the link shared by the host.
          </p>
        </div>
      </div>
    ),
  },
], { basename: '/external' });

export default function App() {
  return (
    <>
      <RouterProvider router={router} />
      <Toaster theme="dark" position="top-right" richColors />
    </>
  );
}
