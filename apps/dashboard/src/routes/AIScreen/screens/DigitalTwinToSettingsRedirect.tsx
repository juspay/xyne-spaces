import { ReactElement } from 'react';
import { Navigate, useLocation, useParams } from 'react-router-dom';

const SEGMENT_MAP: Record<string, string> = {
  overview: 'overview',
  configuration: 'configuration',
  persona: 'configuration',
  memories: 'memories',
  proposals: 'review',
  review: 'review',
  activity: 'activity',
  settings: 'settings',
  learning: 'settings',
  hot: 'hot',
  recall: 'recall',
  graph: 'graph',
  metrics: 'metrics',
};

const DigitalTwinToSettingsRedirect = (): ReactElement => {
  const { pathname } = useLocation();
  const { workspaceId } = useParams<{ workspaceId?: string }>();
  const prefix = workspaceId ? `/${workspaceId}` : '';
  const segments = pathname.split('/').filter(Boolean);
  const twinIndex = segments.lastIndexOf('digital-twin');
  const tail = twinIndex >= 0 ? segments[twinIndex + 1] : undefined;
  const target = tail ? (SEGMENT_MAP[tail] ?? 'overview') : 'overview';

  return <Navigate to={`${prefix}/ai/settings/${target}`} replace />;
};

export default DigitalTwinToSettingsRedirect;
