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
];

function prefixPath(to: LinkProps['to'], workspaceId: string | undefined): LinkProps['to'] {
  if (
    workspaceId &&
    typeof to === 'string' &&
    to.startsWith('/') &&
    !to.startsWith(`/${workspaceId}`) &&
    !WORKSPACE_EXEMPT_PREFIXES.some(prefix => to.startsWith(prefix))
  ) {
    return `/${workspaceId}${to}`;
  }
  return to;
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
