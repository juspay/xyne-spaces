let visible = false;
let hideTimer: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) {
    listener();
  }
}

export function showSwitchOverlay(durationMs: number): void {
  if (durationMs <= 0) {
    return;
  }
  visible = true;
  if (hideTimer !== null) {
    clearTimeout(hideTimer);
  }
  hideTimer = setTimeout(() => {
    visible = false;
    hideTimer = null;
    emit();
  }, durationMs);
  emit();
}

export function isSwitchOverlayVisible(): boolean {
  return visible;
}

export function subscribeSwitchOverlay(listener: () => void): () => void {
  listeners.add(listener);
  return (): void => {
    listeners.delete(listener);
  };
}
