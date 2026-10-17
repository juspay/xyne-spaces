import { useObserve, useValue } from '@legendapp/state/react';
import { type ReactElement } from 'react';

import { createSectionRequests$ } from '@/src/features/quick-actions';
import { Tray } from '@/src/ui/tray';

import {
  closeSectionPicker,
  openSectionCreator,
  sectionPicker$,
  setSectionTrayView,
  type SectionTrayView,
} from '../state/section-picker-store';
import { DeleteSectionView } from './delete-section-view';
import { ManageChannelsView } from './manage-channels-view';
import { NEW_SECTION_VIEW, NewSectionView } from './new-section-view';
import { RenameSectionView } from './rename-section-view';
import {
  DELETE_SECTION_VIEW,
  MANAGE_CHANNELS_VIEW,
  RENAME_SECTION_VIEW,
  SECTION_OPTIONS_VIEW,
  SectionOptionsView,
} from './section-options-view';
import { SECTIONS_VIEW, SectionPickerView } from './section-picker-view';

/**
 * The one tray the screen owns. A channel's Section action opens it on the
 * section picker; the Create section action opens it on the name view; a long
 * press on a section's header opens it on that section's options — and each of
 * those pushes its next step into the same card.
 *
 * Controlled by `sectionPicker$` so a menu item inside any row, or the
 * quick-action button, can open the one tray the screen owns. `resetOnClose` returns it to the picker for the
 * next channel, and the new-section view's draft is dropped with it because
 * the card unmounts its views on dismissal.
 */
export function SectionTray(): ReactElement {
  const isOpen = useValue(sectionPicker$.isOpen);
  const view = useValue(sectionPicker$.view);

  // The quick-action button asks for a section from outside this tree. Only
  // changes are observed, so mounting the screen does not open the tray.
  useObserve(createSectionRequests$, ({ previous }) => {
    if (previous !== undefined) openSectionCreator();
  });

  return (
    <Tray.Root
      open={isOpen}
      onOpenChange={open => {
        if (!open) closeSectionPicker();
      }}
      view={view}
      onViewChange={next => setSectionTrayView(next as SectionTrayView)}
      defaultView={SECTIONS_VIEW}
    >
      <Tray.Content>
        <Tray.Body>
          <Tray.View name={SECTIONS_VIEW} style={{ flexShrink: 1 }}>
            <SectionPickerView />
          </Tray.View>
          <Tray.View name={NEW_SECTION_VIEW} style={{ flexShrink: 1 }}>
            <NewSectionView />
          </Tray.View>
          <Tray.View name={SECTION_OPTIONS_VIEW} style={{ flexShrink: 1 }}>
            <SectionOptionsView />
          </Tray.View>
          <Tray.View name={RENAME_SECTION_VIEW} style={{ flexShrink: 1 }}>
            <RenameSectionView />
          </Tray.View>
          <Tray.View name={MANAGE_CHANNELS_VIEW} style={{ flexShrink: 1 }}>
            <ManageChannelsView />
          </Tray.View>
          <Tray.View name={DELETE_SECTION_VIEW} style={{ flexShrink: 1 }}>
            <DeleteSectionView />
          </Tray.View>
        </Tray.Body>
      </Tray.Content>
    </Tray.Root>
  );
}
