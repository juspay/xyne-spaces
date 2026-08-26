/**
 * CAC key: "disabled_toolbar_paths"
 *
 * One global key shared by all of xyne-spaces — the upstream Superposition
 * instance is provisioned as a single org/workspace for all of xyne-spaces
 * in prod, so per-internal-workspace Superposition dimension targeting
 * isn't something we can provision there (that would require the team
 * owning that shared instance to configure a rule per xyne-spaces tenant).
 * Instead, the per-workspace split lives in the VALUE: it's a map from
 * xyne-spaces workspaceId to that workspace's list of NAVIGATION_ITEMS
 * paths hidden from the sidebar and blocked at the route level (see
 * ToolbarProtectedRoute). useDisabledToolbarPaths indexes into it with the
 * current user's own workspaceId.
 *
 * Toggle from Superposition CAC:
 *   key:   disabled_toolbar_paths
 *   value: {
 *     "<workspaceId-a>": ["/calls", "/support"],
 *     "<workspaceId-b>": ["/browser"]
 *   }
 * A workspaceId with no entry (or the whole key unset) ⇒ nothing hidden.
 */

export const DISABLED_TOOLBAR_PATHS_CAC_KEY = 'disabled_toolbar_paths';

export type DisabledToolbarPathsCacConfig = Record<string, string[]>;

export const DEFAULT_DISABLED_TOOLBAR_PATHS_CAC_CONFIG: DisabledToolbarPathsCacConfig = {};
