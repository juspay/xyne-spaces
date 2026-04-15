const GRAFANA_URL = import.meta.env['VITE_GRAFANA_URL'] || 'http://localhost:3333';
const GRAFANA_LOGS_DS_ID = import.meta.env['VITE_GRAFANA_LOGS_DATASOURCE_ID'] || '8';

export function buildGrafanaLogsExploreUrl(email?: string): string {
  const filters: string[] = ['container:"xyne-logging-bridge"'];
  if (email) {
    filters.push(`emailId:"${email}"`);
  }
  const query = filters.join(' AND ');

  const panes = JSON.stringify({
    left: {
      datasource: GRAFANA_LOGS_DS_ID,
      queries: [{ expr: query, refId: 'A' }],
      range: { from: 'now-1h', to: 'now' },
    },
  });

  return `${GRAFANA_URL}/explore?schemaVersion=1&panes=${encodeURIComponent(panes)}`;
}
