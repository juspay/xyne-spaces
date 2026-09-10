import { ComponentPropsWithoutRef, forwardRef, MouseEvent } from 'react';
import { Link, useLocation } from 'react-router-dom';

/**
 * Dispatched when a citation is re-clicked while the app is already at that
 * exact in-app URL. react-router treats same-location navigation as a no-op, so
 * the already-open file viewer would otherwise ignore the re-click. The viewer
 * (PdfViewer) listens for this and re-jumps to the cited page.
 */
export const CITATION_REJUMP_EVENT = 'xyne:citation-rejump';

interface CitationLinkProps extends Omit<ComponentPropsWithoutRef<'a'>, 'href'> {
  /** Resolved citation URL. */
  url: string;
  /** Open in a new tab (external/off-app) vs same-tab in-app navigation. */
  newTab: boolean;
  /** Convenience alias for `aria-label`. */
  ariaLabel?: string;
}

/**
 * Clickable wrapper for a citation chip. Spaces-native citations navigate within
 * the app via react-router `<Link>` (same tab); external/off-app citations open
 * in a new tab via `<a target="_blank">`. `newTab` is the single switch — derive
 * it from `citationOpensInNewTab` (clawCitationUrl.ts). Both branches render the
 * same `claw-citation-chip`-classed anchor, so the global.css link-style override
 * applies identically.
 *
 * forwardRef + `{...rest}` passthrough are REQUIRED: the chip is used as a Radix
 * `asChild` Tooltip trigger, which clones the trigger to inject hover/focus
 * handlers and a ref onto the underlying <a>. Dropping either kills the tooltip.
 */
export const CitationLink = forwardRef<HTMLAnchorElement, CitationLinkProps>(
  ({ url, newTab, ariaLabel, children, onClick, ...rest }, ref) => {
    const location = useLocation();

    if (newTab) {
      return (
        <a
          ref={ref}
          href={url}
          target='_blank'
          rel='noopener noreferrer'
          aria-label={ariaLabel}
          onClick={onClick}
          data-track-category='citation'
          data-track-name='citation-open-external'
          {...rest}
        >
          {children}
        </a>
      );
    }

    const handleClick = (e: MouseEvent<HTMLAnchorElement>): void => {
      // If the citation points at the URL we're already on, react-router won't
      // re-render, so re-clicking it after scrolling the file would do nothing.
      // Detect that and tell the open viewer to re-jump to the cited page.
      const target = url.split('#')[0];
      const current = `${location.pathname}${location.search}`;
      if (target === current) {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent(CITATION_REJUMP_EVENT));
      }
      onClick?.(e);
    };

    return (
      <Link
        ref={ref}
        to={url}
        aria-label={ariaLabel}
        onClick={handleClick}
        data-track-category='citation'
        data-track-name='citation-open-internal'
        {...rest}
      >
        {children}
      </Link>
    );
  },
);

CitationLink.displayName = 'CitationLink';

export default CitationLink;
