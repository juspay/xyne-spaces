/**
 * Utility functions for Integrity Debug Workflow
 * CSV parsing, log aggregation, and helper functions
 */

import type { SessionData } from './types';
import { logger } from '../../../utils/logger.js';

/**
 * Parse CSV data into session objects
 * Expected CSV format: order_id,merchant_id,failure_reason,gateway,flow
 * @param csvData - Raw CSV string
 * @returns Array of parsed session data
 */
export function parseCSVToSessions(csvData: string): SessionData[] {
  try {
    const lines = csvData.trim().split('\n');

    if (lines.length < 2) {
      throw new Error('CSV must contain at least a header row and one data row');
    }

    // Parse header
    const headers = lines[0].split(',').map((h) => h.trim().toLowerCase());

    // Validate required headers
    const requiredHeaders = ['order_id', 'merchant_id', 'failure_reason', 'gateway', 'flow'];
    const missingHeaders = requiredHeaders.filter((h) => !headers.includes(h));

    if (missingHeaders.length > 0) {
      throw new Error(`CSV missing required headers: ${missingHeaders.join(', ')}`);
    }

    // Get column indexes
    const orderIdIdx = headers.indexOf('order_id');
    const merchantIdIdx = headers.indexOf('merchant_id');
    const failureReasonIdx = headers.indexOf('failure_reason');
    const gatewayIdx = headers.indexOf('gateway');
    const flowIdx = headers.indexOf('flow');

    // Parse data rows
    const sessions: SessionData[] = [];
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue; // Skip empty lines

      const values = line.split(',').map((v) => v.trim());

      const flow = values[flowIdx].toUpperCase();
      if (flow !== 'WEBHOOK' && flow !== 'REDIRECTION' && flow !== 'SYNC') {
        logger.warn(`Invalid flow value '${flow}' at row ${i + 1}, skipping`);
        continue;
      }

      sessions.push({
        orderId: values[orderIdIdx],
        merchantId: values[merchantIdIdx],
        failureReason: values[failureReasonIdx],
        gateway: values[gatewayIdx],
        flow: flow as 'WEBHOOK' | 'REDIRECTION' | 'SYNC',
      });
    }

    logger.info(`Parsed ${sessions.length} sessions from CSV`);
    return sessions;
  } catch (error) {
    logger.error('Error parsing CSV:', error);
    throw new Error(`Failed to parse CSV: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Map research agent repository name to short name
 * @param fullRepoName - Full repository name from research agent (e.g., "euler-api-txns")
 * @returns Short repository name (e.g., "api-txns")
 */
export function mapRepositoryName(fullRepoName: string): 'api-gateway' | 'api-txns' {
  if (fullRepoName.includes('api-txns')) {
    return 'api-txns';
  } else if (fullRepoName.includes('api-gateway')) {
    return 'api-gateway';
  }
  // Default to api-gateway
  return 'api-gateway';
}

/**
 * Determine repository URL based on repository name
 * @param repository - Repository name from code analysis
 * @returns Full git repository URL
 */
export function getRepositoryUrl(repository: 'api-gateway' | 'api-txns'): string {
  const repoMap: Record<string, string> = {
    'api-gateway': 'https://bitbucket.org/juspay/euler-api-gateway.git',
    'api-txns': 'https://bitbucket.org/juspay/euler-api-txns.git',
  };

  const url = repoMap[repository];
  if (!url) {
    throw new Error(`Unknown repository: ${repository}`);
  }

  return url;
}

/**
 * Get the base branch for a repository
 * @param repository - Repository name
 * @returns Base branch name (master for api-gateway, main for api-txns, defaults to master)
 */
export function getRepositoryBaseBranch(repository: 'api-gateway' | 'api-txns'): string {
  const branchMap: Record<string, string> = {
    'api-gateway': 'master',
    'api-txns': 'main',
  };

  return branchMap[repository] || 'master';
}

/**
 * Format gateway issue report for escalation
 * @param analysisDetails - Code analysis result
 * @param logsJson - Aggregated logs in JSON format
 * @returns Formatted report string
 */
export function formatGatewayIssueReport(analysisDetails: any, logsJson: string): string {
  const { analysis_summary, gateway_escalation_details, detailed_findings } = analysisDetails || {};

  let report = `# Gateway Issue Report - Integrity Check Failure\n\n`;

  // Summary section
  if (analysis_summary) {
    report += `## Summary\n${analysis_summary}\n\n`;
  }

  // Issue details section
  if (gateway_escalation_details) {
    report += `## Issue Details\n${gateway_escalation_details}\n\n`;
  } else {
    report += `## Issue Details\nNo specific gateway escalation details provided.\n\n`;
  }

  // Log discrepancies section (optional)
  if (detailed_findings?.log_discrepancies && detailed_findings.log_discrepancies.length > 0) {
    report += `## Log Discrepancies\n`;
    for (const discrepancy of detailed_findings.log_discrepancies) {
      report += `- **Session**: ${discrepancy.session}\n`;
      report += `  - **Field**: ${discrepancy.field}\n`;
      report += `  - **Expected**: ${discrepancy.expected_value}\n`;
      report += `  - **Actual**: ${discrepancy.actual_value}\n`;
      report += `  - **Source**: ${discrepancy.source}\n\n`;
    }
  }

  // Raw logs section
  if (logsJson && logsJson !== '{}') {
    report += `## Raw Log Data\n\`\`\`json\n${logsJson}\n\`\`\`\n`;
  }

  return report;
}

/**
 * Validate that aggregated logs have required data
 * @param logsData - Aggregated logs object
 * @returns Validation result with error messages
 */
export function validateAggregatedLogs(logsData: any): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!logsData.sessions || !Array.isArray(logsData.sessions)) {
    errors.push('Missing or invalid sessions array');
    return { valid: false, errors };
  }

  if (logsData.sessions.length === 0) {
    errors.push('No sessions found in aggregated logs');
    return { valid: false, errors };
  }

  // Check each session for required fields
  for (let i = 0; i < logsData.sessions.length; i++) {
    const session = logsData.sessions[i];

    if (!session.order_id) {
      errors.push(`Session ${i + 1}: Missing order_id`);
    }
    if (!session.txn_detail) {
      errors.push(`Session ${i + 1}: Missing txn_detail`);
    }
    if (!session.order_reference) {
      errors.push(`Session ${i + 1}: Missing order_reference`);
    }
    if (!session.flow_logs) {
      errors.push(`Session ${i + 1}: Missing flow_logs`);
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Extract research agent session ID from response text
 * @param responseText - Research agent response
 * @returns Session ID or null if not found
 */
export function extractResearchSessionId(responseText: string): string | null {
  const sessionIdMatch = responseText.match(/Session ID for continuation:\*\*\s*([a-f0-9-]+)/i);
  if (sessionIdMatch && sessionIdMatch[1]) {
    return sessionIdMatch[1];
  }
  return null;
}