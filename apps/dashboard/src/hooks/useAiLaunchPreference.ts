import { useLayoutEffect } from 'react';
import { useAILandingDefault } from './useAILandingDefault';
import { useToolbarItems } from './useToolbarItems';

/** Path of the Xyne AI item in NAVIGATION_ITEMS / the toolbar selection. */
export const AI_TOOLBAR_PATH = '/ai';

/**
 * "Open AI on launch" (Preferences → Launch) and the Xyne AI item
 * (Preferences → Toolbar), kept consistent with each other.
 *
 * They are separate preferences in separate localStorage keys —
 * `xyne:ai-landing-default` drives HomeScreen's redirect, `xyne:toolbar-items`
 * drives the sidebar rail — and nothing stopped them contradicting each other:
 * AI could be your start page while its toolbar item was hidden, which reads
 * as the launch setting being broken.
 *
 * The invariant is one-directional: landing on AI implies the AI item is in
 * the toolbar.
 *   - turning "Open AI on launch" ON adds /ai to the toolbar
 *   - hiding /ai from the toolbar turns "Open AI on launch" OFF
 *
 * Existing contradictory localStorage state is also repaired on first render:
 * the effective launch preference is immediately OFF when /ai is absent, and a
 * layout effect persists that correction before HomeScreen navigates.
 *
 * The opposite two moves are deliberately inert, so neither switch can undo a
 * choice the user did not make:
 *   - turning "Open AI on launch" OFF leaves the toolbar untouched (the icon
 *     is still useful when AI is not the start page)
 *   - showing /ai in the toolbar does NOT opt you back into landing on it
 */
export const useAiLaunchPreference = (): {
  aiLandingDefault: boolean;
  setAiLandingDefault: (value: boolean) => void;
  aiInToolbar: boolean;
  setAiInToolbar: (value: boolean) => void;
} => {
  const { aiLandingDefault, setAiLandingDefault: setStoredAiLandingDefault } =
    useAILandingDefault();
  const { toolbarPaths, setInToolbar } = useToolbarItems();
  const aiInToolbar = toolbarPaths.has(AI_TOOLBAR_PATH);
  const hasContradictoryStoredState = aiLandingDefault && !aiInToolbar;

  // Migrate users who previously stored Launch=ON while Toolbar AI=OFF. The
  // effective value below is already false on this first render, so HomeScreen
  // cannot redirect to /ai; persisting in a layout effect repairs storage before
  // Navigate's passive effect runs.
  useLayoutEffect(() => {
    if (hasContradictoryStoredState) setStoredAiLandingDefault(false);
  }, [hasContradictoryStoredState, setStoredAiLandingDefault]);

  const setAiLandingDefault = (value: boolean): void => {
    setStoredAiLandingDefault(value);
    // Landing on AI with its toolbar item hidden is the contradictory state
    // this hook exists to prevent; switching it off implies nothing.
    if (value) setInToolbar(AI_TOOLBAR_PATH, true);
  };

  const setAiInToolbar = (value: boolean): void => {
    setInToolbar(AI_TOOLBAR_PATH, value);
    // Hiding the item must retire the start-page preference too, otherwise
    // the user lands on a screen they just removed from their toolbar.
    if (!value) setStoredAiLandingDefault(false);
  };

  return {
    aiLandingDefault: aiLandingDefault && aiInToolbar,
    setAiLandingDefault,
    aiInToolbar,
    setAiInToolbar,
  };
};
