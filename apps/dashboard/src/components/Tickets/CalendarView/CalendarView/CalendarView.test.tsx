// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Ticket } from '@xyne/shared';
import { CalendarView } from './CalendarView';

const state = vi.hoisted(() => ({ enabled: true, mode: 'eta' }));
vi.mock('../../../../hooks/useDependencyState', () => ({
  useTicketDependenciesEnabled: () => state.enabled,
}));
vi.mock('../../../../hooks/useAuth', () => ({
  useAuth: () => ({ user: { id: 'user', workspaceId: 'workspace' } }),
}));
vi.mock('../../../../machines/userPreferencesMachine', () => ({
  useUserPreference: () => ({ '["workspace","test"]': state.mode }),
  setUserPreference: vi.fn(),
}));
vi.mock('../CalendarToolbar', () => ({ CalendarToolbar: () => null }));
vi.mock('../MonthView', () => ({ MonthView: () => null }));
vi.mock('../WeekView', () => ({ WeekView: () => null }));
vi.mock('../DayView', () => ({ DayView: () => null }));
vi.mock('../CompactTicketBadge', () => ({
  CompactTicketBadge: ({ ticket, onClick }: { ticket: Ticket; onClick: () => void }) => (
    <button onClick={onClick} data-track-category='test' data-track-name='calendar_no_eta_open'>
      {ticket.title}
    </button>
  ),
}));

async function flush(action: () => void): Promise<void> {
  await act(async () => {
    action();
    await Promise.resolve();
  });
}

// Mounted component contract only; child badges, identity, preferences and calendar views are mocked.
describe('calendar No ETA tray', () => {
  let root: Root;
  let container: HTMLDivElement;
  const undated = { id: 'undated', title: 'Needs planning', eta: null } as Ticket;
  const epoch = { id: 'epoch', title: 'Epoch ticket', eta: 0 } as Ticket;
  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    state.enabled = true;
    state.mode = 'eta';
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });
  afterEach(async () => {
    await flush(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });
  it('starts collapsed, expands and opens the original undated ticket', async () => {
    const open = vi.fn();
    await flush(() =>
      root.render(<CalendarView tickets={[undated, epoch]} viewKey='test' onTicketClick={open} />),
    );
    const tray = container.querySelector('details')!;
    expect(tray.open).toBe(false);
    expect(tray.querySelector('summary')?.textContent).toBe('No ETA (1)');
    await flush(() => tray.querySelector('summary')!.click());
    expect(tray.open).toBe(true);
    expect(tray.textContent).not.toContain('Epoch ticket');
    await flush(() => tray.querySelector('button')!.click());
    expect(open).toHaveBeenCalledWith(undated);
  });
  it('hides the tray in Created mode and when the feature is disabled', async () => {
    state.mode = 'created';
    await flush(() => root.render(<CalendarView tickets={[undated]} viewKey='test' />));
    expect(container.querySelector('details')).toBeNull();
    state.mode = 'eta';
    state.enabled = false;
    await flush(() => root.render(<CalendarView tickets={[undated]} viewKey='test' />));
    expect(container.querySelector('details')).toBeNull();
  });
});
