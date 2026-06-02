import { WarningCircleIcon } from "@phosphor-icons/react";
import { Button } from "../ui/Button";

interface DigitalTwinErrorProps {
  message: string;
  onRetry: () => void;
}

export function DigitalTwinError({ message, onRetry }: DigitalTwinErrorProps) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-[12px] py-[64px]">
      <WarningCircleIcon size={48} className="text-xyne-error-fg" />
      <p className="text-[14px] text-xyne-fg-muted">{message}</p>
      <Button variant="secondary" onClick={onRetry}>
        Retry
      </Button>
    </div>
  );
}
