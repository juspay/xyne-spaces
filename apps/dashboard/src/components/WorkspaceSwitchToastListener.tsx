import { useEffect, useRef } from 'react';
import { toast } from 'sonner';
import { consumeWorkspaceSwitchToast } from '../utils/workspaceSwitchToast';

export function WorkspaceSwitchToastListener(): null {
  const hasChecked = useRef(false);

  useEffect(() => {
    if (hasChecked.current) return;
    hasChecked.current = true;

    const pending = consumeWorkspaceSwitchToast();
    if (!pending) return;
    toast.success(pending.title, {
      ...(pending.description ? { description: pending.description } : {}),
      duration: 3000,
    });
  }, []);

  return null;
}
