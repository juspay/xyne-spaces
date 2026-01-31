import { useState, useRef, useCallback, useEffect } from 'react';
import type { MentionHoverOptions, MentionHoverHandlers } from './MentionText.types';

type PopoverCloseFunction = () => void;

const popoverRegistry = new Set<PopoverCloseFunction>();

export const registerPopover = (closeFn: PopoverCloseFunction): (() => void) => {
  popoverRegistry.add(closeFn);

  return () => {
    popoverRegistry.delete(closeFn);
  };
};

export const closeAllMentionPopovers = (): void => {
  popoverRegistry.forEach(closeFn => closeFn());
};

export const useMentionHover = (options: MentionHoverOptions = {}): MentionHoverHandlers => {
  const { enterDelay = 300, leaveDelay = 200 } = options;

  const [isOpen, setIsOpen] = useState(false);
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);

  const enterTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const leaveTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const handleMouseEnter = useCallback(
    (event: React.MouseEvent<HTMLElement>) => {
      // Clear any pending leave timeout
      if (leaveTimeoutRef.current) {
        clearTimeout(leaveTimeoutRef.current);
        leaveTimeoutRef.current = null;
      }

      // Set anchor element
      setAnchorEl(event.currentTarget);

      // Show after delay
      enterTimeoutRef.current = setTimeout(() => {
        setIsOpen(true);
      }, enterDelay);
    },
    [enterDelay],
  );

  const handleMouseLeave = useCallback(() => {
    // Clear any pending enter timeout
    if (enterTimeoutRef.current) {
      clearTimeout(enterTimeoutRef.current);
      enterTimeoutRef.current = null;
    }

    // Hide after delay
    leaveTimeoutRef.current = setTimeout(() => {
      setIsOpen(false);
      setAnchorEl(null);
    }, leaveDelay);
  }, [leaveDelay]);

  const handlePopoverEnter = useCallback(() => {
    // Cancel leave timeout when entering popover
    if (leaveTimeoutRef.current) {
      clearTimeout(leaveTimeoutRef.current);
      leaveTimeoutRef.current = null;
    }
  }, []);

  const handlePopoverLeave = useCallback(() => {
    // Start leave timeout when leaving popover
    leaveTimeoutRef.current = setTimeout(() => {
      setIsOpen(false);
      setAnchorEl(null);
    }, leaveDelay);
  }, [leaveDelay]);

  const handleClose = useCallback(() => {
    setIsOpen(false);
    setAnchorEl(null);

    if (enterTimeoutRef.current) {
      clearTimeout(enterTimeoutRef.current);
      enterTimeoutRef.current = null;
    }
    if (leaveTimeoutRef.current) {
      clearTimeout(leaveTimeoutRef.current);
      leaveTimeoutRef.current = null;
    }
  }, []);

  // Register this popover for global management
  useEffect(() => {
    return registerPopover(handleClose);
  }, [handleClose]);

  return {
    isOpen,
    anchorEl,
    handleMouseEnter,
    handleMouseLeave,
    handlePopoverEnter,
    handlePopoverLeave,
    handleClose,
  };
};
