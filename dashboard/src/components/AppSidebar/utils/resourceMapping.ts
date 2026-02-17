/**
 * Maps sidebar navigation paths to their corresponding resource names
 * Used for permission checks to determine which navigation items to show
 */
export const PATH_TO_RESOURCE: Record<string, string> = {
  '/tickets': 'TICKETS',
  '/knowledge-base': 'KNOWLEDGE-BASE',
  '/analytics': 'ANALYTICS',
  '/user-groups': 'USER-GROUPS',
  '/listProjects': 'LISTPROJECTS',
  '/resource-access': 'USERS',
  '/forms': 'FORMS',
  '/support': 'SUPPORT',
  '/product-insights': 'PRODUCT-INSIGHTS',
  '/projects': 'PROJECTS',
};
