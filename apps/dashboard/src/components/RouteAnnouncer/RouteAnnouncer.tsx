import { useEffect, useRef, useState, type ReactElement } from 'react';
import { useLocation } from 'react-router-dom';

/**
 * WCAG 4.1.3 (Status Messages, AA) — announces client-side navigation.
 *
 * In a multi-page app the browser tells a screen reader when a new page loads.
 * Spaces is a SPA: React Router swaps the route content and the assistive
 * technology is told nothing at all, so a blind user activates a nav item and
 * has no confirmation that anything happened.
 *
 * This is the same pattern Next.js ships as its route announcer: a visually
 * hidden polite live region that, after each navigation, announces the new
 * document title.
 *
 * Reading `document.title` rather than deriving a label from the pathname is
 * deliberate — screens that know their own name (ChatView sets the channel
 * name, NotFoundScreen sets "Page not found") set it in their own effect, and
 * a child's effect runs before this parent's. Two animation frames let the
 * route's own effects land first, so we announce what the screen calls itself
 * instead of a guess made from the URL.
 */
export const RouteAnnouncer = (): ReactElement => {
  const { pathname } = useLocation();
  const [message, setMessage] = useState('');
  const isFirstRender = useRef(true);

  useEffect(() => {
    // The initial load is announced by the browser itself; repeating it here
    // would make the screen reader say the page name twice.
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }

    let cancelled = false;
    const outer = requestAnimationFrame(() => {
      const inner = requestAnimationFrame(() => {
        if (cancelled) {
          return;
        }
        const title = document.title.trim();
        // Re-setting the same string does not re-trigger the live region, so
        // navigating between two screens with the same title needs a nudge.
        setMessage(previous => (previous === title ? `${title} ` : title));
      });
      if (cancelled) {
        cancelAnimationFrame(inner);
      }
    });

    return (): void => {
      cancelled = true;
      cancelAnimationFrame(outer);
    };
  }, [pathname]);

  return (
    <div aria-live='polite' aria-atomic='true' className='sr-only'>
      {message}
    </div>
  );
};
