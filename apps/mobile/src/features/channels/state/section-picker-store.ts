import { observable } from '@legendapp/state';

export type SectionTrayView =
  | 'sections'
  | 'new-section'
  | 'section-options'
  | 'rename-section'
  | 'manage-channels'
  | 'delete-section'
  | 'section-filter'
  | 'section-sort';

type SectionPickerState = {
  isOpen: boolean;
  /** Which view of the tray is showing; opening picks the starting one. */
  view: SectionTrayView;
  /**
   * The section being managed, for the options and the views they lead to.
   * `null` with `isChannelsGroup` means the `Channels` group instead.
   */
  sectionId: string | null;
  /** The options are for `Channels`, which offers only its filter and sort. */
  isChannelsGroup: boolean;
  /**
   * The channel being moved. Kept after close on purpose: the tray is still on
   * screen while it dismisses, and clearing this would blank its title.
   */
  channelId: string | null;
};

/**
 * Whether the section tray is up and for which channel.
 *
 * A store rather than state on the screen, because the thing that opens it is
 * a menu item deep inside one row. The row writes here; the single tray the
 * screen owns reads.
 */
export const sectionPicker$ = observable<SectionPickerState>({
  isOpen: false,
  view: 'sections',
  sectionId: null,
  isChannelsGroup: false,
  channelId: null,
});

/** Move one channel: starts on the list of sections. */
export function openSectionPicker(channelId: string): void {
  sectionPicker$.set({
    isOpen: true,
    view: 'sections',
    sectionId: null,
    isChannelsGroup: false,
    channelId,
  });
}

/** Create a section from nowhere in particular: starts on the name view. */
export function openSectionCreator(): void {
  sectionPicker$.set({
    isOpen: true,
    view: 'new-section',
    sectionId: null,
    isChannelsGroup: false,
    channelId: null,
  });
}

/** Rename, manage, delete, filter or sort one section: starts on its options. */
export function openSectionOptions(sectionId: string): void {
  sectionPicker$.set({
    isOpen: true,
    view: 'section-options',
    sectionId,
    isChannelsGroup: false,
    channelId: null,
  });
}

/** Filter or sort the `Channels` group: the same options view, with only those two. */
export function openChannelsGroupOptions(): void {
  sectionPicker$.set({
    isOpen: true,
    view: 'section-options',
    sectionId: null,
    isChannelsGroup: true,
    channelId: null,
  });
}

export function setSectionTrayView(view: SectionTrayView): void {
  sectionPicker$.view.set(view);
}

export function closeSectionPicker(): void {
  sectionPicker$.isOpen.set(false);
}
