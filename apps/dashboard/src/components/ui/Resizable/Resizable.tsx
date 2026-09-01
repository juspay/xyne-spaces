import { ReactElement } from 'react';
import { Group, useDefaultLayout, type GroupProps } from 'react-resizable-panels';

export {
  Panel,
  Separator,
  usePanelRef,
  useGroupRef,
  type PanelImperativeHandle,
  type GroupImperativeHandle,
  type PanelSize,
} from 'react-resizable-panels';

type ResizableGroupProps = Omit<GroupProps, 'defaultLayout' | 'onLayoutChanged'> & {
  /**
   * Persist this group's layout to localStorage under the given id.
   *
   * ⚠️ Every Panel in a persisted group needs an explicit `id` — v4 keys the saved
   * layout by panel id, and the `useId` fallback is not stable across reloads.
   */
  autoSaveId?: string | null;
  /**
   * Panel ids rendered on mount, for groups whose Panels are conditional. Lets the
   * group restore the right saved layout instead of the last one written.
   */
  panelIds?: string[] | undefined;
};

const PersistedGroup = ({
  autoSaveId,
  panelIds,
  ...rest
}: ResizableGroupProps & { autoSaveId: string }): ReactElement => {
  const { defaultLayout, onLayoutChanged } = useDefaultLayout({
    id: autoSaveId,
    panelIds,
    // Window resizes and imperative resize() calls shouldn't overwrite the width the
    // user picked — only their own drags should.
    onlySaveAfterUserInteractions: true,
  });

  return <Group defaultLayout={defaultLayout} onLayoutChanged={onLayoutChanged} {...rest} />;
};

/**
 * `Group` from react-resizable-panels with v3's `autoSaveId` convenience restored.
 *
 * Panels default to `preserve-relative-size` — they keep their percentage when the
 * group resizes. Pass `groupResizeBehavior='preserve-pixel-size'` on a Panel (with
 * px `minSize`/`maxSize`) to pin it to a fixed width instead; at least one Panel in
 * the group must stay relative.
 */
export const ResizableGroup = ({
  autoSaveId,
  panelIds,
  ...rest
}: ResizableGroupProps): ReactElement => {
  if (!autoSaveId) {
    return <Group {...rest} />;
  }

  // Keyed so a changing autoSaveId (per-ticket, per-channel groups) remounts and
  // reads that id's saved layout rather than keeping the previous one.
  return <PersistedGroup key={autoSaveId} autoSaveId={autoSaveId} panelIds={panelIds} {...rest} />;
};

ResizableGroup.displayName = 'ResizableGroup';
