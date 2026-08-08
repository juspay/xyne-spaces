/**
 * Maps sidebar navigation paths to their corresponding resource names
 * Used for permission checks to determine which navigation items to show
 */
export const PATH_TO_RESOURCE: Record<string, string> = {
  '/support': 'SUPPORT',
  // NOTE (XYNE-55452): '/knowledge-base' is intentionally NOT mapped to a resource.
  // The Knowledge Base entry must be visible/accessible to every workspace user
  // regardless of resource access, so it is deliberately left ungated here.
  // Do not re-add a KNOWLEDGE-BASE mapping without revisiting that requirement.
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
  '/organisations': 'ORGANIZATIONS',
  '/team-intelligence': 'TEAM-INTELLIGENCE-DASHBOARD',
};
