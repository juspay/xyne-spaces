import type { Automation } from '../../Automation.types';

export interface VersionHistoryProps {
  automationId: string;
  onOpenVersion: (version: Automation) => void;
  onBack: () => void;
}
