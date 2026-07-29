import { TreeStructureIcon } from "@phosphor-icons/react";
import { Button } from "../ui/Button";

interface SubagentNotFoundProps {
  onBack: () => void;
}

export function SubagentNotFound({ onBack }: SubagentNotFoundProps) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 py-16">
      <TreeStructureIcon size={48} weight="thin" className="text-xyne-fg-muted" />
      <p className="text-[14px] font-medium text-xyne-fg-primary">
        Subagent not found
      </p>
      <p className="text-[13px] text-xyne-fg-tertiary">
        The subagent you're looking for doesn't exist or has been deleted.
      </p>
      <Button variant="secondary" size="sm" onClick={onBack}>
        Back to subagents
      </Button>
    </div>
  );
}
