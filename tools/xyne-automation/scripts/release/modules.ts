// Product modules a release check reports on, each mapped to the test folders that cover it.
// Shared by release-check.ts (which folders to run) and build-summary-report.ts (how to group
// results), so a run and its report always agree on what "Chat" or "Calls" means.

export interface ReleaseModule {
  key: string;
  label: string;
  folders: string[];
}

export const RELEASE_MODULES: ReleaseModule[] = [
  {
    key: 'auth',
    label: 'Auth & login',
    folders: [
      'tests/02_ui/01_login-screen',
      'tests/03_e2e/01_unauthenticated-redirect',
      'tests/03_e2e/02_auth',
    ],
  },
  { key: 'projects', label: 'Projects', folders: ['tests/03_e2e/03_project'] },
  {
    key: 'chat',
    label: 'Chat',
    folders: ['tests/02_ui/04_input-box', 'tests/03_e2e/04_channel', 'tests/03_e2e/05_messaging'],
  },
  {
    key: 'tickets',
    label: 'Tickets',
    folders: ['tests/02_ui/03_tickets-ui', 'tests/03_e2e/06_tickets'],
  },
  { key: 'canvas', label: 'Canvas', folders: ['tests/03_e2e/07_canvas'] },
  { key: 'calls', label: 'Calls', folders: ['tests/03_e2e/08_calls'] },
  { key: 'user-groups', label: 'User groups', folders: ['tests/03_e2e/09_user-groups'] },
  { key: 'navigation', label: 'Navigation', folders: ['tests/02_ui/02_navigation'] },
  { key: 'api', label: 'API health', folders: ['tests/01_api/01_health'] },
];

/**
 * Module label for a spec file. Gauge reports absolute paths (inside Docker in CI runs), so this
 * matches on the `tests/<area>/<folder>` part. A folder no module lists yet is reported under its
 * own name rather than dropped, so new test folders still show up in the report.
 */
export function moduleLabelForSpec(specFile: string): string {
  const matches = specFile.replace(/\\/g, '/').match(/tests\/\d+_[^/]+\/\d+_[^/]+(?=\/)/g);
  if (!matches) return 'Other';
  const folder = matches[matches.length - 1];
  const module = RELEASE_MODULES.find((m) => m.folders.includes(folder));
  return module ? module.label : folder.replace(/^.*\/\d+_/, '');
}
