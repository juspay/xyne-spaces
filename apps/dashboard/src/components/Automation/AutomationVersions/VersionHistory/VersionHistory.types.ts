import type { Automation } from '../../Automation.types';

export interface VersionHistoryProps {
  automationId: string;
  onOpenVersion: (version: Automation) => void;
  onCompare: (fromId: string, toId: string) => void;
  onBack: () => void;
}
