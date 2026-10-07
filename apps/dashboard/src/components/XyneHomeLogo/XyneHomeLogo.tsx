import type { ReactElement } from 'react';
import { Link } from 'react-router-dom';
import { cn } from '../../utils/classNames';

interface XyneHomeLogoProps {
  /** Classes for the logo image (controls its size). */
  imgClassName?: string;
  /** Extra classes for the wrapping link. */
  className?: string;
  /** Surface name, sent as tracking metadata so clicks can be split by screen. */
  source: string;
}

/**
 * The Xyne wordmark as a link back to the app's home.
 *
 * Links to `/` on purpose rather than a workspace-specific path: the root route
 * already resolves the current workspace and its landing page (or `/auth` when
 * signed out), so the logo never pins a stale workspace after a switch.
 */
const XyneHomeLogo = ({ imgClassName, className, source }: XyneHomeLogoProps): ReactElement => (
  <Link
    to='/'
    aria-label='Go to home'
    data-testid='xyne-home-logo'
    data-track-category='Xyne_Logo'
    data-track-name='Xyne_Logo_Home'
    data-track-metadata={JSON.stringify({ source })}
    className={cn(
      'inline-flex items-center rounded-sm cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
      className,
    )}
  >
    <img src='/svgs/xyne.svg' alt='Xyne' className={imgClassName} draggable='false' />
  </Link>
);

export default XyneHomeLogo;
