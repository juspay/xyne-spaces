import { type ReactElement } from 'react';
import { DiagnosticsPanel } from './DiagnosticsPanel';
import { useRequestPerformanceHelp } from '../../services/diagnostics/requestHelp';

interface DockedDiagnosticsPanelProps {
  onClose: () => void;
}

/**
 * The panel as rendered in AppRoot's resizable group.
 *
 * Exists so `useRequestPerformanceHelp` — which needs a Zero client — is called
 * from inside `ZeroProvider`. AppRoot itself renders that provider rather than
 * living under it, so calling the hook in AppRoot's body throws. The mobile
 * overlay mounts above the provider entirely and so renders `DiagnosticsPanel`
 * directly, without the help action.
 */
export function DockedDiagnosticsPanel({ onClose }: DockedDiagnosticsPanelProps): ReactElement {
  const requestHelp = useRequestPerformanceHelp();
  return <DiagnosticsPanel onClose={onClose} onRequestHelp={requestHelp} />;
}
