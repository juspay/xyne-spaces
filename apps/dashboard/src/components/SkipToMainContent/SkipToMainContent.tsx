import { type ReactElement } from 'react';

/** Shared so the skip target and the skip control can never drift apart. */
export const MAIN_CONTENT_ID = 'main-content';

/**
 * WCAG 2.4.1 (Bypass Blocks, Level A).
 *
 * Every app screen renders the workspace sidebar before the route content, so a
 * keyboard or screen-reader user had to tab through the whole sidebar on every
 * navigation before reaching what they came for. This is the standard bypass:
 * visually hidden until focused, first thing in the tab order, and it moves
 * focus into the route's `<main id="main-content">`.
 *
 * It is a <button>, not an <a href="#main-content">, on purpose. App.tsx installs
 * a document-level click handler that intercepts every same-origin anchor and
 * hands it to the router, so a hash anchor here would be turned into a
 * navigation and focus would never move. Focusing the target directly is also
 * the more reliable behaviour: a hash jump scrolls but does not always move
 * keyboard focus in Firefox/Safari.
 */
export const SkipToMainContent = (): ReactElement => {
  const handleSkip = (): void => {
    const main = document.getElementById(MAIN_CONTENT_ID);
    if (!main) {
      return;
    }
    // <main> carries tabIndex={-1} so it can receive programmatic focus without
    // entering the tab order itself.
    main.focus();
    main.scrollIntoView({ block: 'start' });
  };

  return (
    <button
      type='button'
      onClick={handleSkip}
      data-track-category='ACCESSIBILITY'
      data-track-name='SKIP_TO_MAIN_CONTENT'
      className='sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[100] focus:rounded-md focus:bg-background focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-foreground focus:shadow-lg focus:outline-none focus:ring-2 focus:ring-ring'
    >
      Skip to main content
    </button>
  );
};
