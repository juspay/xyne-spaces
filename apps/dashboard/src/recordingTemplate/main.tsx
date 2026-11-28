import ReactDOM from 'react-dom/client';
import '@livekit/components-styles';
import './recordingTemplate.css';
import RecordingTemplateApp from './RecordingTemplateApp';

// Entry for recording/template.html, the page LiveKit egress opens to record an end-to-end
// encrypted call. It loads only the call view, not the app.

ReactDOM.createRoot(document.getElementById('root')!).render(<RecordingTemplateApp />);
