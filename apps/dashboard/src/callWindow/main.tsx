import ReactDOM from 'react-dom/client';
import '../global.css';
import '@xyne/workflow-ui/styles.css';
import '../styles/workflow-ui-theme.css';
import { globalClickTracker } from '../services/Analytics/globalClickTracker';
import { installErrorReporting } from '../bootstrap/errorReporting';
import { startCallWindowHost } from '../utils/callWindowHost';
import CallWindowApp from './CallWindowApp';

// Entry for the desktop call window's page (newWindow/call.html). The main
// app's entry is src/main.tsx; this one loads only the call.

// Expose app version to window for Electron access
window.__APP_VERSION__ = __APP_VERSION__;

installErrorReporting();
globalClickTracker.initialize();

// The call starts before React renders: connecting needs only the token the
// main window handed over, not the app's data.
startCallWindowHost();

ReactDOM.createRoot(document.getElementById('root')!).render(<CallWindowApp />);
