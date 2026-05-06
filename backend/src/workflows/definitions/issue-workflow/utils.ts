/**
 * Utility functions for Issue Workflow
 */

/**
 * Repository configuration for known repositories
 * Can be extended with more repositories as needed
 */
const REPOSITORY_CONFIG: Record<string, {
  baseBranch: string;
  fullName: string;
  org?: string;
}> = {
  'api-gateway': {
    baseBranch: 'master',
    fullName: 'euler-api-gateway',
    org: 'juspay',
  },
  'api-txns': {
    baseBranch: 'main',
    fullName: 'euler-api-txns',
    org: 'juspay',
  },
  'api-customer': {
    baseBranch: 'main',
    fullName: 'euler-api-customer',
    org: 'juspay',
  },
  'api-order': {
    baseBranch: 'main',
    fullName: 'euler-api-order',
    org: 'juspay',
  },
  'api-cards': {
    baseBranch: 'main',
    fullName: 'euler-api-cards',
    org: 'juspay',
  },
  'api-dashboard': {
    baseBranch: 'main',
    fullName: 'euler-api-dashboard',
    org: 'juspay',
  },
  'api-pre-txn': {
    baseBranch: 'main',
    fullName: 'euler-api-pre-txn',
    org: 'juspay',
  },
  'api-token': {
    baseBranch: 'main',
    fullName: 'euler-api-token',
    org: 'juspay',
  },
  'offer-engine': {
    baseBranch: 'main',
    fullName: 'offer-engine',
    org: 'juspay',
  },
  // Add more repositories as needed
};

/**
 * Get repository base branch
 * Defaults to 'main' for unknown repositories
 */
export function getRepositoryBaseBranch(repository: string): string {
  const config = REPOSITORY_CONFIG[repository];
  return config?.baseBranch || 'main';
}

/**
 * Get repository ID for cloning (org/repo format)
 * Defaults to juspay org if not specified
 */
export function getRepositoryId(repository: string): string {
  const config = REPOSITORY_CONFIG[repository];
  if (config) {
    const org = config.org || 'juspay';
    return `${org}/${config.fullName}`;
  }
  // Default: assume it's in juspay org with same name
  return `juspay/${repository}`;
}

/**
 * Get repository full name
 */
export function getRepositoryFullName(repository: string): string {
  const config = REPOSITORY_CONFIG[repository];
  return config?.fullName || repository;
}

/**
 * Format issue type for display
 */
export function formatIssueType(issueType: string): string {
  const typeMap: Record<string, string> = {
    'bug': 'Bug',
    'feature_request': 'Feature Request',
    'improvement': 'Improvement',
    'question': 'Question',
    'other': 'Other',
  };
  return typeMap[issueType] || issueType;
}

/**
 * Format severity for display
 */
export function formatSeverity(severity: string): string {
  const severityMap: Record<string, string> = {
    'critical': 'Critical',
    'high': 'High',
    'medium': 'Medium',
    'low': 'Low',
  };
  return severityMap[severity] || severity;
}

/**
 * Generate investigation report when issue is not fixable
 */
export function formatInvestigationReport(
  issueType: string,
  severity: string,
  affectedComponents: string[],
  rootCause?: string,
  investigationSteps?: string[]
): string {
  let report = '# Investigation Report\n\n';

  report += `**Issue Type:** ${formatIssueType(issueType)}\n`;
  report += `**Severity:** ${formatSeverity(severity)}\n`;
  report += `**Affected Components:** ${affectedComponents.join(', ')}\n\n`;

  if (rootCause) {
    report += `## Root Cause\n\n${rootCause}\n\n`;
  }

  if (investigationSteps && investigationSteps.length > 0) {
    report += `## Investigation Steps\n\n`;
    investigationSteps.forEach((step, idx) => {
      report += `${idx + 1}. ${step}\n`;
    });
    report += '\n';
  }

  report += `## Recommendation\n\n`;
  report += `This issue requires further investigation or manual intervention. `;
  report += `Please follow the investigation steps above or consult with the relevant team.\n`;

  return report;
}
