import type { MessageRowModel } from './chatRow.types';

export const STATUS_LINE_HEIGHT = 16;

export type StatusChrome = {
  showEdited: boolean;
  showBookmark: boolean;
  reminderLabel: string | null;
  showPinned: boolean;
};

/**
 * V2's footer contract, expressed as data so paint and measurement cannot
 * drift. Calls and show-in-channel rows own their own surfaces; they do not
 * become arbitrary footer labels.
 */
export const statusChromeFor = (model: MessageRowModel): StatusChrome => {
  if (model.isDeleted) {
    return {
      showEdited: false,
      showBookmark: false,
      reminderLabel: null,
      showPinned: false,
    };
  }

  return {
    showEdited:
      model.isEdited && (model.rowKind === 'CURRENT_USER' || model.rowKind === 'OTHER_USER'),
    showBookmark: model.isBookmarked || model.reminderLabel !== null,
    reminderLabel: model.reminderLabel,
    showPinned: model.isPinned,
  };
};

export const hasStatusChrome = (model: MessageRowModel): boolean => {
  const status = statusChromeFor(model);
  return status.showEdited || status.showBookmark || status.showPinned;
};
