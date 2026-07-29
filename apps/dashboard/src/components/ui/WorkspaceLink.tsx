import { Link, NavLink, useParams } from 'react-router-dom-actual';
import type { LinkProps, NavLinkProps } from 'react-router-dom-actual';
import { ReactElement } from 'react';

const WORKSPACE_EXEMPT_PREFIXES = [
  '/auth',
  '/invite',
  '/launch',
  '/newWindow',
  '/redirected',
  '/call/',
  '/api/',
];

function normalizeSameOriginPath(to: string): string {
  if (typeof window === 'undefined' || !/^https?:\/\//i.test(to)) return to;
  try {
    const url = new URL(to);
    if (url.origin === window.location.origin) {
      return `${url.pathname}${url.search}${url.hash}`;
    }
  } catch {
    return to;
  }
  return to;
}

function prefixPath(to: LinkProps['to'], workspaceId: string | undefined): LinkProps['to'] {
  const normalizedTo = typeof to === 'string' ? normalizeSameOriginPath(to) : to;
  if (
    workspaceId &&
    typeof normalizedTo === 'string' &&
    normalizedTo.startsWith('/') &&
    !normalizedTo.startsWith(`/${workspaceId}`) &&
    !WORKSPACE_EXEMPT_PREFIXES.some(prefix => normalizedTo.startsWith(prefix))
  ) {
    return `/${workspaceId}${normalizedTo}`;
  }
  return normalizedTo;
}

/** Drop-in replacement for react-router-dom's `Link` that auto-prefixes workspace paths. */
export const WorkspaceLink = (props: LinkProps): ReactElement => {
  const { workspaceId } = useParams<{ workspaceId?: string }>();
  const { to, ...rest } = props;
  return <Link to={prefixPath(to, workspaceId)} {...rest} />;
};

/** Drop-in replacement for react-router-dom's `NavLink` that auto-prefixes workspace paths. */
export const WorkspaceNavLink = (props: NavLinkProps): ReactElement => {
  const { workspaceId } = useParams<{ workspaceId?: string }>();
  const { to, ...rest } = props;
  return <NavLink to={prefixPath(to, workspaceId)} {...rest} />;
};

// Re-export as the same names so files only need to change their import path.
export { WorkspaceLink as Link, WorkspaceNavLink as NavLink };
