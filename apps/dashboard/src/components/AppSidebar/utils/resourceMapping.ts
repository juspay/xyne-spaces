/**
 * Maps sidebar navigation paths to their corresponding resource names
 * Used for permission checks to determine which navigation items to show
 */
export const PATH_TO_RESOURCE: Record<string, string> = {
  '/support': 'SUPPORT',
  '/sdlc': 'SDLC',
  '/analytics': 'ANALYTICS',
  '/dashboards': 'ANALYTICS',
  '/user-groups': 'USER-GROUPS',
  '/listProjects': 'LISTPROJECTS',
  '/resource-access': 'USERS',
  '/roles': 'ROLES',
  '/migration/confluence': 'CONFLUENCE-MIGRATION',
  '/forms': 'FORMS',
  '/projects': 'PROJECTS',
  '/workspace-management': 'WORKSPACE',
  '/tag-review': 'WORKSPACE',
  '/organisations': 'ORGANIZATIONS',
  '/team-intelligence': 'TEAM-INTELLIGENCE-DASHBOARD',
  '/workflows': 'WORKFLOWS',
};
