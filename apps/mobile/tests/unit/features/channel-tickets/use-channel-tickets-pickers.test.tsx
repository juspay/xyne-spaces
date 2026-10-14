/* eslint-disable @typescript-eslint/no-require-imports -- jest.mock factories run before imports and cannot reference module scope */
import { describe, expect, it, jest } from '@jest/globals';
import { type ReactElement } from 'react';
import { act, create } from 'react-test-renderer';

jest.mock('@xyne/shared', () => require('../../../mocks/xyne-shared'));

// The desk overlay hooks drive Reanimated; replace them with plain state so the
// orchestration can be observed synchronously.
jest.mock('@/src/features/xyne-desks/tickets/hooks', () => {
  const React = require('react') as typeof import('react');
  const useOverlay = (): {
    isMounted: boolean;
    isOpen: boolean;
    progress: { value: number };
    open: () => void;
    close: () => void;
  } => {
    const [isOpen, setIsOpen] = React.useState(false);
    return {
      isMounted: isOpen,
      isOpen,
      progress: { value: isOpen ? 1 : 0 },
      open: () => setIsOpen(true),
      close: () => setIsOpen(false),
    };
  };
  return { useTicketsAssigneeFilterOverlay: useOverlay, useTicketsFilterOverlay: useOverlay };
});

import {
  useChannelTicketsPickers,
  type UseChannelTicketsPickersReturn,
} from '@/src/features/channel-tickets/hooks/use-channel-tickets-pickers';

let latest!: UseChannelTicketsPickersReturn;

function Probe(): ReactElement | null {
  latest = useChannelTicketsPickers();
  return null;
}

const mount = (): void => {
  act(() => {
    create(<Probe />);
  });
};

describe('useChannelTicketsPickers', () => {
  it('starts with nothing open', () => {
    mount();
    expect(latest.isAnyOpen).toBe(false);
    expect(latest.drawerOpen).toBe(false);
  });

  it('opens a picker only after the drawer reports closed', () => {
    mount();
    act(() => latest.openDrawer());
    expect(latest.drawerOpen).toBe(true);

    act(() => latest.selectFromDrawer('assignee'));
    // Drawer asked to close; the picker must wait for the sheet's own close callback.
    expect(latest.drawerOpen).toBe(false);
    expect(latest.assigneeOverlay.isOpen).toBe(false);

    act(() => latest.handleDrawerOpenChange(false));
    expect(latest.assigneeOverlay.isOpen).toBe(true);
    expect(latest.isAnyOpen).toBe(true);
  });

  it('routes each drawer row to its own picker', () => {
    mount();
    act(() => latest.selectFromDrawer('priority'));
    act(() => latest.handleDrawerOpenChange(false));
    expect(latest.prioritySheetOpen).toBe(true);
    act(() => {
      latest.dismissAll();
    });

    act(() => latest.selectFromDrawer('stages'));
    act(() => latest.handleDrawerOpenChange(false));
    expect(latest.stagesOverlay.isOpen).toBe(true);
    act(() => {
      latest.dismissAll();
    });

    act(() => latest.selectFromDrawer('boards'));
    act(() => latest.handleDrawerOpenChange(false));
    expect(latest.boardsOverlay.isOpen).toBe(true);
  });

  it('a swipe-dismissed drawer with no selection opens nothing', () => {
    mount();
    act(() => latest.openDrawer());
    act(() => latest.handleDrawerOpenChange(false));
    expect(latest.isAnyOpen).toBe(false);
  });

  it('dismissAll closes whatever is open, drops a pending picker, and reports it', () => {
    mount();
    expect(latest.dismissAll()).toBe(false);

    act(() => latest.openDrawer());
    act(() => latest.selectFromDrawer('assignee'));
    let handled = false;
    act(() => {
      handled = latest.dismissAll();
    });
    // Drawer was already closing; a pending picker must not fire afterwards.
    act(() => latest.handleDrawerOpenChange(false));
    expect(latest.assigneeOverlay.isOpen).toBe(false);
    expect(latest.isAnyOpen).toBe(false);
    expect(handled).toBe(false);

    act(() => latest.setPrioritySheetOpen(true));
    act(() => {
      handled = latest.dismissAll();
    });
    expect(handled).toBe(true);
    expect(latest.prioritySheetOpen).toBe(false);
  });
});
