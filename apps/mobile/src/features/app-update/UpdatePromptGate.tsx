import { useStartupPhase } from '@/src/providers/StartupPhaseProvider';
import { useAuth } from '@/src/contexts/AuthContext';
import { useLotusUpdatePrompt } from '@/src/services/cac';
import { UpdatePromptBottomSheet } from './UpdatePromptBottomSheet';

export function UpdatePromptGate() {
  const { isSignedIn } = useAuth();
  const { hasFirstFramePainted, isProtectedStartupReady } = useStartupPhase();

  const enabled = isSignedIn && hasFirstFramePainted && isProtectedStartupReady;

  const { visible, decision, dismissOptional } = useLotusUpdatePrompt(enabled);

  if (decision.kind === 'none') return null;

  const cfg = decision.config;

  return (
    <UpdatePromptBottomSheet
      open={visible}
      mode={decision.kind}
      title={cfg.title}
      message={cfg.message}
      storeUrl={cfg.storeUrl}
      {...(decision.kind === 'optional' ? { onDismiss: dismissOptional } : {})}
    />
  );
}
