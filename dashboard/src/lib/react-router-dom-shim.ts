/**
 * react-router-dom shim
 *
 * This file is aliased as 'react-router-dom' in vite.config.ts so that all
 * existing imports (e.g. `import { useNavigate, Link } from 'react-router-dom'`)
 * transparently get our workspace-aware versions at runtime without any
 * per-file changes.
 *
 * IMPORTANT: this file must import from 'react-router-dom-actual' (the real
 * package, aliased in vite.config.ts) to avoid circular imports.
 */

// Re-export everything from the real react-router-dom
export * from 'react-router-dom-actual';

// These named exports shadow the identically-named ones above (TS 5+ / Rollup behaviour)
export { useWorkspaceNavigate as useNavigate } from '../hooks/useWorkspaceNavigate';
export { WorkspaceLink as Link, WorkspaceNavLink as NavLink } from '../components/ui/WorkspaceLink';
