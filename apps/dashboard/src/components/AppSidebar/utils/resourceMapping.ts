/**
 * Maps sidebar navigation paths to their corresponding resource names
 * Used for permission checks to determine which navigation items to show
 */
export const PATH_TO_RESOURCE: Record<string, string> = {
  '/support': 'SUPPORT',
  '/sdlc': 'SDLC',
  '/analytics': 'ANALYTICS',
  '/dashboards': 'ANALYTICS',
  '/listProjects': 'LISTPROJECTS',
  '/migration/confluence': 'CONFLUENCE-MIGRATION',
  '/forms': 'FORMS',
  '/projects': 'PROJECTS',
  '/tag-review': 'WORKSPACE',
  // Organisations bundles several resources; see organisationsAccess().
  '/organisations': 'ORGANIZATIONS',
  '/team-intelligence': 'TEAM-INTELLIGENCE-DASHBOARD',
  '/workflows': 'WORKFLOWS',
};
