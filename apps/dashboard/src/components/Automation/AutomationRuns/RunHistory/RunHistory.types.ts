import type { AutomationRun } from '../../Automation.types';

export interface RunHistoryProps {
  automationId: string;
  onOpenRun: (run: AutomationRun) => void;
  onBack: () => void;
}
