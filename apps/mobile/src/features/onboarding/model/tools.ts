/**
 * Connectors offered on the last card.
 *
 * Presentation only for now: tapping Connect records the id in the answers and nothing else. The
 * OAuth handoff lands later, and should read this same catalogue.
 */

export interface ConnectorTool {
  id: string;
  label: string;
  /** Monogram shown until the real marks are bundled. */
  initial: string;
  tint: string;
}

export const CONNECTOR_TOOLS: readonly ConnectorTool[] = [
  { id: 'gmail', label: 'Gmail', initial: 'M', tint: '#EA4335' },
  { id: 'github', label: 'GitHub', initial: 'G', tint: '#F5F5F5' },
  { id: 'google-calendar', label: 'Google Calendar', initial: 'C', tint: '#4285F4' },
  { id: 'google-drive', label: 'Google Drive', initial: 'D', tint: '#34A853' },
  { id: 'slack', label: 'Slack', initial: 'S', tint: '#E01E5A' },
  { id: 'notion', label: 'Notion', initial: 'N', tint: '#CFCFCF' },
];
