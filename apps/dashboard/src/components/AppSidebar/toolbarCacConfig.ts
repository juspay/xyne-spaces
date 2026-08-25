/**
 * CAC key: "disabled_toolbar_paths"
 *
 * Per-workspace list of NAVIGATION_ITEMS paths hidden from the sidebar and
 * blocked at the route level (see ToolbarProtectedRoute). Resolved by
 * Superposition using the request's `workspaceId` context (see
 * cacConfigController.ts) — configure per-workspace overrides in
 * Superposition's own dashboard, keyed on that dimension.
 *
 * Toggle from Superposition CAC:
 *   key:   disabled_toolbar_paths
 *   value: ["/calls", "/support"]  ← paths hidden for the targeted workspace
 *   value: []                      ← nothing hidden (default)
 */

export const DISABLED_TOOLBAR_PATHS_CAC_KEY = 'disabled_toolbar_paths';

export type DisabledToolbarPathsCacConfig = string[];

export const DEFAULT_DISABLED_TOOLBAR_PATHS_CAC_CONFIG: DisabledToolbarPathsCacConfig = [];
