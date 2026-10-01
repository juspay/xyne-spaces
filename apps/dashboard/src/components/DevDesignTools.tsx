import { ReactElement } from 'react';
import { DialRoot, DialStore } from 'dialkit';
import 'dialkit/styles.css';
import { Mesurer } from 'mesurer';

/**
 * Whether DialKit is open, and which of its panels are expanded, kept across
 * reloads and page changes. DialKit itself keeps neither: it opens on every
 * load, and forgets a panel's state when the page that owns it unmounts, so the
 * next page that shows it pops it open again.
 */
const OPEN_KEY = 'xyne.dev.dialkit.open.v1';

interface SavedOpen {
  root?: boolean;
  panels: Record<string, boolean>;
}

function readOpen(): SavedOpen {
  try {
    const value = JSON.parse(window.localStorage.getItem(OPEN_KEY) ?? '{}') as Partial<SavedOpen>;
    return {
      ...(typeof value.root === 'boolean' ? { root: value.root } : {}),
      panels: value.panels && typeof value.panels === 'object' ? value.panels : {},
    };
  } catch {
    return { panels: {} };
  }
}

function saveOpen(update: (saved: SavedOpen) => SavedOpen): void {
  try {
    window.localStorage.setItem(OPEN_KEY, JSON.stringify(update(readOpen())));
  } catch {
    // Storage blocked: DialKit just opens as it likes.
  }
}

// Before DialRoot renders any panel, so a saved state wins over its default.
// A panel registers again on every page that uses it, so restore on each one.
const restorePanels = (): void => {
  const saved = readOpen().panels;
  for (const panel of DialStore.getPanels()) {
    const open = saved[panel.id];
    if (open !== undefined) DialStore.initPanelOpen(panel.id, open);
  }
};
restorePanels();
DialStore.subscribeGlobal(restorePanels);
DialStore.subscribePanelOpen((panelId, open) =>
  saveOpen(saved => ({ ...saved, panels: { ...saved.panels, [panelId]: open } })),
);

/** Design-tuning overlays (DialKit panels, Mesurer ruler). Loaded in dev builds only. */
export default function DevDesignTools(): ReactElement {
  return (
    <>
      <DialRoot
        // Closed until you open it once; then as you left it.
        defaultOpen={readOpen().root ?? false}
        onOpenChange={open => saveOpen(saved => ({ ...saved, root: open }))}
      />
      <Mesurer />
    </>
  );
}
