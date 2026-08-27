import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import { Provider as TooltipProvider } from '@radix-ui/react-tooltip';
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
    // FullCallView is shared with the dashboard, and its CallControls use Tooltip
    // ~16 times. Radix's Tooltip.Root throws without a Provider ancestor, and the
    // dashboard mounts one at its own root — so reusing that view here means
    // mounting one too, or the call view crashes on render.
    //
    // Imported from @radix-ui/react-tooltip rather than @/components/ui/Tooltip
    // on purpose: the dashboard's TooltipProvider is a thin wrapper over this
    // same primitive, and going direct keeps dashboard-external off the
    // approved-entry-point list that .dependency-cruiser.cjs enforces.
    //
    // delayDuration matches the dashboard so tooltips feel identical in both.
    <TooltipProvider delayDuration={0}>
      <RouterProvider router={router} />
      <Toaster theme="dark" position="top-right" richColors />
    </TooltipProvider>
  );
}
