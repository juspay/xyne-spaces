import { describe, expect, it } from 'vitest';
import { createActor } from 'xstate';
import { browserPanelMachine, BrowserTab } from '../browserPanelMachine';

// Replicates what BrowserTabsScreen.handleCreateTab does per invocation:
// a NEW tab object with a fresh id (crypto.randomUUID) for the SAME url.
const makeTab = (url: string): BrowserTab => ({
  id: crypto.randomUUID(),
  url,
  title: url,
  canGoBack: false,
  canGoForward: false,
  isLoading: false,
});

const freshActor = () => {
  const actor = createActor(browserPanelMachine).start();
  actor.send({ type: 'OPEN' });
  return actor;
};

describe('browserPanelMachine addTab duplicate-tab race', () => {
  it('same-tick double ADD_TAB for one URL creates ONE tab (race regression)', () => {
    const actor = freshActor();
    const url = 'https://example.com/docs';
    actor.send({ type: 'ADD_TAB', tab: makeTab(url) });
    actor.send({ type: 'ADD_TAB', tab: makeTab(url) }); // second click / pendingUrls flush
    const snap = actor.getSnapshot();
    expect(snap.context.tabs).toHaveLength(1);
    expect(snap.context.tabs[0].url).toBe(url);
    expect(snap.context.activeTabId).toBe(snap.context.tabs[0].id);
  });

  it('re-adding the exact same id is still a no-op (existing behavior preserved)', () => {
    const actor = freshActor();
    const tab = makeTab('https://example.com/same-id');
    actor.send({ type: 'ADD_TAB', tab });
    actor.send({ type: 'ADD_TAB', tab: { ...tab } });
    expect(actor.getSnapshot().context.tabs).toHaveLength(1);
  });

  it('distinct URLs still create distinct tabs (no over-dedupe)', () => {
    const actor = freshActor();
    actor.send({ type: 'ADD_TAB', tab: makeTab('https://a.example.com') });
    actor.send({ type: 'ADD_TAB', tab: makeTab('https://b.example.com') });
    expect(actor.getSnapshot().context.tabs).toHaveLength(2);
  });
});
