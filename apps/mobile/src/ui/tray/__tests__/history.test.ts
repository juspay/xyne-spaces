import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { canGoBack, currentView, initialTrayState, trayReducer, type TrayState } from '../history';

const DEFAULT = 'main';
const reduce = (state: TrayState, action: Parameters<typeof trayReducer>[1]): TrayState =>
  trayReducer(state, action, DEFAULT);

describe('tray history', () => {
  it('starts closed on the default view', () => {
    const state = initialTrayState(DEFAULT);
    assert.equal(state.visible, false);
    assert.equal(currentView(state, DEFAULT), DEFAULT);
    assert.equal(canGoBack(state), false);
  });

  it('opens on the default view when none is named', () => {
    const state = reduce(initialTrayState(DEFAULT), { type: 'open' });
    assert.equal(state.visible, true);
    assert.equal(currentView(state, DEFAULT), DEFAULT);
  });

  it('treats an entry point as a root, not a continuation', () => {
    let state = reduce(initialTrayState(DEFAULT), { type: 'open' });
    state = reduce(state, { type: 'setView', id: 'date' });
    state = reduce(state, { type: 'close' });
    state = reduce(state, { type: 'open', view: 'filters' });

    assert.equal(currentView(state, DEFAULT), 'filters');
    assert.equal(canGoBack(state), false);
  });

  it('pushes and pops views', () => {
    let state = reduce(initialTrayState(DEFAULT), { type: 'open' });
    state = reduce(state, { type: 'setView', id: 'date' });
    assert.equal(currentView(state, DEFAULT), 'date');
    assert.equal(canGoBack(state), true);

    state = reduce(state, { type: 'goBack' });
    assert.equal(currentView(state, DEFAULT), DEFAULT);
    assert.equal(canGoBack(state), false);
  });

  it('ignores goBack at the root', () => {
    const open = reduce(initialTrayState(DEFAULT), { type: 'open' });
    assert.equal(reduce(open, { type: 'goBack' }), open);
  });

  it('ignores setView to the view already showing', () => {
    const open = reduce(initialTrayState(DEFAULT), { type: 'open' });
    assert.equal(reduce(open, { type: 'setView', id: DEFAULT }), open);
  });

  it('keeps the stack on close so the exit still has a view to render', () => {
    let state = reduce(initialTrayState(DEFAULT), { type: 'open' });
    state = reduce(state, { type: 'setView', id: 'date' });
    state = reduce(state, { type: 'close' });

    assert.equal(state.visible, false);
    assert.equal(currentView(state, DEFAULT), 'date');
  });
});
