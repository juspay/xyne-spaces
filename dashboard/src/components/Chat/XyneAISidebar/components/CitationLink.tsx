import { ComponentPropsWithoutRef, forwardRef } from 'react';
import { Link } from 'react-router-dom';

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
  ({ url, newTab, ariaLabel, children, ...rest }, ref) => {
    if (newTab) {
      return (
        <a
          ref={ref}
          href={url}
          target='_blank'
          rel='noopener noreferrer'
          aria-label={ariaLabel}
          {...rest}
        >
          {children}
        </a>
      );
    }
    return (
      <Link ref={ref} to={url} aria-label={ariaLabel} {...rest}>
        {children}
      </Link>
    );
  },
);

CitationLink.displayName = 'CitationLink';

export default CitationLink;
