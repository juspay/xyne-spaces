import type { AutomationRunSummary } from '../../Automation.types';

export interface RunHistoryProps {
  automationId: string;
  onOpenRun: (run: AutomationRunSummary) => void;
  onBack: () => void;
}
