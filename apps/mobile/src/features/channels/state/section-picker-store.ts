import { observable } from '@legendapp/state';

export type SectionTrayView =
  | 'sections'
  | 'new-section'
  | 'section-options'
  | 'rename-section'
  | 'manage-channels'
  | 'delete-section';

type SectionPickerState = {
  isOpen: boolean;
  /** Which view of the tray is showing; opening picks the starting one. */
  view: SectionTrayView;
  /** The section being managed, for the options / rename / manage / delete views. */
  sectionId: string | null;
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
  channelId: null,
});

/** Move one channel: starts on the list of sections. */
export function openSectionPicker(channelId: string): void {
  sectionPicker$.set({ isOpen: true, view: 'sections', sectionId: null, channelId });
}

/** Create a section from nowhere in particular: starts on the name view. */
export function openSectionCreator(): void {
  sectionPicker$.set({ isOpen: true, view: 'new-section', sectionId: null, channelId: null });
}

/** Rename, manage or delete one section: starts on its options. */
export function openSectionOptions(sectionId: string): void {
  sectionPicker$.set({ isOpen: true, view: 'section-options', sectionId, channelId: null });
}

export function setSectionTrayView(view: SectionTrayView): void {
  sectionPicker$.view.set(view);
}

export function closeSectionPicker(): void {
  sectionPicker$.isOpen.set(false);
}
