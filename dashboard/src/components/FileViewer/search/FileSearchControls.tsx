import React from 'react';
import { useShortcutById } from '../../../shortcuts';
import { useFileSearchContext } from './FileSearchContext';
import { FindBar } from './FindBar';

/**
 * Binds the viewer find shortcuts and renders the find bar. Must be rendered
 * inside a FileSearchProvider, alongside the viewer it searches.
 *
 * Shortcuts stay disabled until a viewer registers itself as searchable, so
 * mod+f still falls through to channel find for image/video previews instead of
 * opening a find bar with nothing to search.
 */
export const FileSearchControls: React.FC = () => {
  const search = useFileSearchContext();
  const canSearch = Boolean(search?.hasTarget);

  useShortcutById(
    'viewer.find',
    () => {
      search?.open();
    },
    { enabled: canSearch },
  );

  useShortcutById(
    'viewer.findNext',
    () => {
      search?.next();
    },
    { enabled: canSearch && Boolean(search?.isOpen) },
  );

  useShortcutById(
    'viewer.findPrevious',
    () => {
      search?.prev();
    },
    { enabled: canSearch && Boolean(search?.isOpen) },
  );

  return <FindBar />;
};
