/* eslint-disable local-rules/require-tracking-on-click */
import { ReactElement, useState, useCallback } from 'react';
import { ExternalLink } from 'lucide-react';
import { webviewActor } from '../../machines/webviewMachine';
import { buildGrafanaLogsExploreUrl } from './grafanaUrl';
import ContextBar from './ContextBar';
import LogsTab from './LogsTab';
import GraphsTab from './GraphsTab';

type InspectorTab = 'logs' | 'graphs';

export default function Inspector(): ReactElement {
  const [activeTab, setActiveTab] = useState<InspectorTab>('logs');

  const handleOpenGrafana = useCallback(() => {
    webviewActor.send({ type: 'OPEN', url: buildGrafanaLogsExploreUrl() });
  }, []);

  return (
    <div className='flex flex-col h-full bg-background rounded-xl overflow-hidden'>
      <ContextBar />

      {/* Tab bar */}
      <div className='flex items-center gap-2 px-4 pt-2 pb-0 border-b border-border bg-card/50'>
        <button
          onClick={() => setActiveTab('logs')}
          className={`px-4 py-1.5 text-sm font-medium rounded-t-md transition-colors ${
            activeTab === 'logs'
              ? 'text-foreground border-b-2 border-primary'
              : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          Logs
        </button>
        <button
          onClick={() => setActiveTab('graphs')}
          className={`px-4 py-1.5 text-sm font-medium rounded-t-md transition-colors ${
            activeTab === 'graphs'
              ? 'text-foreground border-b-2 border-primary'
              : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          Graphs
        </button>
        <span className='ml-auto' />
        <button
          onClick={handleOpenGrafana}
          className='inline-flex items-center gap-2 px-4 py-2 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted/50 rounded-md transition-colors'
        >
          <ExternalLink size={13} />
          Open Grafana
        </button>
      </div>

      {/* Tab content */}
      <div className='flex-1 overflow-hidden'>
        {activeTab === 'logs' && <LogsTab />}
        {activeTab === 'graphs' && <GraphsTab />}
      </div>
    </div>
  );
}
