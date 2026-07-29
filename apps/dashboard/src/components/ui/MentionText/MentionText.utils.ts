type PopoverCloseFunction = () => void;

const popoverRegistry = new Set<PopoverCloseFunction>();

export const registerPopover = (closeFn: PopoverCloseFunction): (() => void) => {
  popoverRegistry.add(closeFn);

  return () => {
    popoverRegistry.delete(closeFn);
  };
};
