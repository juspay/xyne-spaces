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
  '/jira-migration': 'TICKET-MIGRATION',
  '/migration/confluence': 'CONFLUENCE-MIGRATION',
  '/migration/whatsapp': 'TICKET-MIGRATION',
  '/forms': 'FORMS',
  '/product-insights': 'PRODUCT-INSIGHTS',
  '/projects': 'PROJECTS',
  '/workspace-management': 'WORKSPACE',
  '/tag-review': 'WORKSPACE',
  '/organisations': 'ORGANIZATIONS',
  '/team-intelligence': 'TEAM-INTELLIGENCE-DASHBOARD',
  '/workflows': 'WORKFLOWS',
};
