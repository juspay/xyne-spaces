'use strict';

/**
 * Dependency-cruiser configuration for dashboard-external.
 *
 * Run from the dashboard-external/ directory:
 *   npx depcruise src --config .dependency-cruiser.cjs --output-type err-long
 *
 * This replaces the custom no-zero-in-external ESLint rule in dashboard/.
 * It performs a full AST import-graph traversal starting from dashboard-external/src/
 * (following imports into dashboard/src/ through the @/ alias) and enforces two rules:
 *
 *  1. no-zero-in-external-graph — every module reachable from dashboard-external
 *     must not import Zero sync primitives (useZero, ZeroProvider, mutators).
 *     There is no ZeroProvider in this app; data mutations must go through callLobbyService.
 *
 *  2. no-unapproved-dashboard-entry-points — dashboard-external/src may only
 *     DIRECTLY import the approved entry points from dashboard/src.
 *     Adding new ones requires updating both this rule and adding a review.
 *
 * Stubs: ThreadPannel is replaced with a lightweight stub in vite.config.ts.
 * We stop traversal at that file so its real implementation is not analysed.
 */

/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: 'no-zero-in-external-graph',
      comment:
        'A module reachable from dashboard-external imports a Zero sync primitive. ' +
        'There is no ZeroProvider in this app. ' +
        'Refactor the component to be stateless: accept data as props and use ' +
        'callLobbyService for mutations instead of zero.mutate.',
      severity: 'error',
      from: {},
      to: {
        // Matches ../dashboard/src/hooks/useZero.ts etc. (dep-cruiser shows
        // paths relative to cwd = dashboard-external/, hence the ../dashboard/ prefix)
        path: 'dashboard/src/hooks/useZero\\.ts$|dashboard/src/hooks/useZeroWithFallback\\.ts$|dashboard/src/zero/mutators\\.ts$|dashboard/src/providers/ZeroProvider\\.tsx$',
      },
    },
    {
      name: 'no-unapproved-dashboard-entry-points',
      comment:
        'dashboard-external/src directly imported a dashboard/src module that is not ' +
        'on the approved entry-point list. ' +
        'Approved entry points: roomMachine, FullCallView, callLobbyService, useHandRaise. ' +
        'To add a new one, update this rule and get a code-review.',
      severity: 'error',
      from: {
        path: '^src/',
      },
      to: {
        // Any dashboard/src import …
        path: 'dashboard/src/',
        // … except the approved ones
        pathNot: [
          'dashboard/src/machines/roomMachine\\.ts$',
          'dashboard/src/components/Call/CallViews/FullCallView\\.tsx$',
          'dashboard/src/services/Call/callLobbyService\\.ts$',
          'dashboard/src/components/Call/hooks/useHandRaise\\.ts$',
        ],
      },
    },
  ],

  options: {
    doNotFollow: {
      // Don't recurse into node_modules, ThreadPannel (replaced by a vite stub),
      // or InviteToCallModal (guarded by a hideInvite prop — never rendered for
      // external users, and its internal Zero usage is not relevant to this bundle).
      path: 'node_modules|dashboard/src/components/Chat/ThreadPannel\\.tsx$|dashboard/src/components/Call/CallModals/InviteToCallModal\\.tsx$',
    },

    // Analyse TypeScript source directly (pre-compilation) so type-only imports
    // are also visible in the graph.
    tsPreCompilationDeps: true,

    tsConfig: {
      // Picks up the @/ → ../dashboard/src/* alias and strict settings.
      fileName: './tsconfig.app.json',
    },

    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'require', 'node', 'default'],
      mainFields: ['module', 'main', 'types', 'typings'],
    },

    reporterOptions: {
      text: {
        highlightFocused: true,
      },
    },
  },
};
