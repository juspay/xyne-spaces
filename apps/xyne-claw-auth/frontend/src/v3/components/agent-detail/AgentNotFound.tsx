import { RobotIcon } from "@phosphor-icons/react";
import { Button } from "../ui/Button";

interface AgentNotFoundProps {
  onBack: () => void;
}

export function AgentNotFound({ onBack }: AgentNotFoundProps) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 py-16">
      <RobotIcon size={48} weight="thin" className="text-xyne-fg-muted" />
      <p className="text-[14px] font-medium text-xyne-fg-primary">
        Agent not found
      </p>
      <p className="text-[13px] text-xyne-fg-tertiary">
        The agent you're looking for doesn't exist or has been deleted.
      </p>
      <Button variant="secondary" size="sm" onClick={onBack}>
        Back to agents
      </Button>
    </div>
  );
}
