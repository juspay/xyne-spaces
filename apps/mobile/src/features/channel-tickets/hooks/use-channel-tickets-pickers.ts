import { useCallback, useRef, useState } from 'react';

import {
  useTicketsAssigneeFilterOverlay,
  useTicketsFilterOverlay,
} from '@/src/features/xyne-desks/tickets/hooks';

import type { ChannelTicketsFilterKind } from '../types';

export type UseChannelTicketsPickersReturn = {
  drawerOpen: boolean;
  prioritySheetOpen: boolean;
  assigneeOverlay: ReturnType<typeof useTicketsAssigneeFilterOverlay>;
  stagesOverlay: ReturnType<typeof useTicketsFilterOverlay>;
  boardsOverlay: ReturnType<typeof useTicketsFilterOverlay>;
  /** True while any drawer / picker is up; back navigation must close it first. */
  isAnyOpen: boolean;
  openDrawer: () => void;
  /** Controlled-sheet callback for the drawer. Opens a pending picker once closed. */
  handleDrawerOpenChange: (open: boolean) => void;
  /** Drawer row tap: remember the picker, close the drawer. */
  selectFromDrawer: (kind: ChannelTicketsFilterKind) => void;
  setPrioritySheetOpen: (open: boolean) => void;
  /** Close whatever is open. Returns true when something was closed. */
  dismissAll: () => boolean;
};

/**
 * Orchestrates the Filters drawer and the four value pickers so exactly one
 * surface is up at a time: a drawer row records the picker to open, the drawer
 * closes, and the picker opens from the drawer's own close callback (after its
 * animation) rather than on top of it.
 */
export function useChannelTicketsPickers(): UseChannelTicketsPickersReturn {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [prioritySheetOpen, setPrioritySheetOpen] = useState(false);
  const assigneeOverlay = useTicketsAssigneeFilterOverlay();
  const stagesOverlay = useTicketsFilterOverlay();
  const boardsOverlay = useTicketsFilterOverlay();
  const pendingPickerRef = useRef<ChannelTicketsFilterKind | null>(null);

  const openPicker = useCallback(
    (kind: ChannelTicketsFilterKind) => {
      switch (kind) {
        case 'assignee':
          assigneeOverlay.open();
          return;
        case 'stages':
          stagesOverlay.open();
          return;
        case 'boards':
          boardsOverlay.open();
          return;
        case 'priority':
          setPrioritySheetOpen(true);
          return;
      }
    },
    [assigneeOverlay, stagesOverlay, boardsOverlay],
  );

  const openDrawer = useCallback(() => {
    pendingPickerRef.current = null;
    setDrawerOpen(true);
  }, []);

  const selectFromDrawer = useCallback((kind: ChannelTicketsFilterKind) => {
    pendingPickerRef.current = kind;
    setDrawerOpen(false);
  }, []);

  const handleDrawerOpenChange = useCallback(
    (open: boolean) => {
      setDrawerOpen(open);
      if (open) return;
      const pending = pendingPickerRef.current;
      pendingPickerRef.current = null;
      if (pending) openPicker(pending);
    },
    [openPicker],
  );

  const isAnyOpen =
    drawerOpen ||
    prioritySheetOpen ||
    assigneeOverlay.isOpen ||
    stagesOverlay.isOpen ||
    boardsOverlay.isOpen;

  const dismissAll = useCallback((): boolean => {
    // A back press while the drawer is still animating closed must also cancel
    // the picker it was about to open, even though nothing counts as open yet.
    pendingPickerRef.current = null;
    if (!isAnyOpen) return false;
    if (drawerOpen) setDrawerOpen(false);
    if (prioritySheetOpen) setPrioritySheetOpen(false);
    if (assigneeOverlay.isOpen) assigneeOverlay.close();
    if (stagesOverlay.isOpen) stagesOverlay.close();
    if (boardsOverlay.isOpen) boardsOverlay.close();
    return true;
  }, [isAnyOpen, drawerOpen, prioritySheetOpen, assigneeOverlay, stagesOverlay, boardsOverlay]);

  return {
    drawerOpen,
    prioritySheetOpen,
    assigneeOverlay,
    stagesOverlay,
    boardsOverlay,
    isAnyOpen,
    openDrawer,
    handleDrawerOpenChange,
    selectFromDrawer,
    setPrioritySheetOpen,
    dismissAll,
  };
}
