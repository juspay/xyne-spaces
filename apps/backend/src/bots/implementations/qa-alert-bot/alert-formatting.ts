export type JenkinsAlertCategory =
  | 'automation_failed'
  | 'automation_skipped'
  | 'non_automation_failed'
  | 'build_success'
  | 'build_unstable'
  | 'build_aborted'
  | 'build_unknown';

export interface JenkinsWebhookPayload {
  event: string;
  status: string;
  branch: string;
  buildNumber: string;
  buildUrl: string;
  prUrl?: string;
  contributor: string;
  failedStage?: string;
  ticketXyneId?: string;
  commitMessage?: string;
  message: string;
  testsPassed?: number;
  testsFailed?: number;
  testsSkipped?: number;
  testsTotal?: number;
  cucumberReportUrl?: string;
  userGroupAlias?: string;
  // Loose string support keeps webhook parsing backward-compatible with older Jenkins payloads.
  alertCategory?: JenkinsAlertCategory | string;
  failureReason?: string;
  mentionHtmlList?: string[];
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function safeHttpUrl(value?: string): string | null {
  if (!value) {
    return null;
  }

  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : null;
  } catch {
    return null;
  }
}

function deriveStatusText(payload: JenkinsWebhookPayload): string {
  const normalizedStatus = normalizeWhitespace(payload.status || '').toUpperCase();
  if (normalizedStatus) {
    switch (normalizedStatus) {
      case 'FAILURE':
      case 'FAILED':
      case 'ERROR':
        return 'FAILED';
      case 'SUCCESS':
        return 'SUCCESS';
      case 'SKIPPED':
      case 'WARNING':
        return 'SKIPPED';
      case 'UNSTABLE':
        return 'UNSTABLE';
      case 'ABORTED':
        return 'ABORTED';
      default:
        return 'UNKNOWN';
    }
  }

  switch (payload.event) {
    case 'build_success':
      return 'SUCCESS';
    case 'build_failed':
    case 'automation_bypass_detected':
      return 'FAILED';
    case 'automation_skipped':
      return 'SKIPPED';
    case 'build_unstable':
      return 'UNSTABLE';
    case 'build_aborted':
      return 'ABORTED';
    default:
      return 'UNKNOWN';
  }
}

function deriveHeadline(payload: JenkinsWebhookPayload): string {
  switch (payload.alertCategory) {
    case 'automation_failed':
      return '🚨 Automation Test Failed';
    case 'automation_skipped':
      return '🚨 ⏭️ Automation Test Skipped';
    case 'non_automation_failed':
      return '🚨 Non-automation Stage Failed';
    case 'build_success':
      return '✅🎉 Build Success';
    case 'build_unstable':
      return '⚠️ Build Unstable';
    case 'build_aborted':
      return '⛔ Build Aborted';
    default:
      return `📣 ${normalizeWhitespace(payload.message || 'Build notification')}`;
  }
}

export function formatGroupMention(
  groupId: string,
  groupName: string,
  groupAlias?: string | null,
  memberCount?: number,
): string {
  // Security-sensitive HTML construction: keep every interpolated attribute/value escaped.
  const aliasAttr = groupAlias ? ` data-group-alias="${escapeHtml(groupAlias)}"` : '';
  const memberCountAttr = memberCount !== undefined ? ` data-member-count="${memberCount}"` : '';

  return `<span class="chat-input-group-mention" data-mention-type="group" data-group-id="${escapeHtml(groupId)}" data-group-name="${escapeHtml(groupName)}"${aliasAttr}${memberCountAttr}>@${escapeHtml(groupAlias || groupName)}</span>`;
}

export function formatUserMention(
  userId: string,
  username: string,
  options?: { email?: string | null; picture?: string | null },
): string {
  // Security-sensitive HTML construction: keep every interpolated attribute/value escaped.
  const emailAttr = options?.email ? ` data-user-email="${escapeHtml(options.email)}"` : '';
  const pictureAttr = options?.picture ? ` data-user-picture="${escapeHtml(options.picture)}"` : '';

  return `<span class="chat-input-mention" data-mention="" data-mention-type="user" data-user-id="${escapeHtml(userId)}" data-username="${escapeHtml(username)}"${emailAttr}${pictureAttr}>@${escapeHtml(username)}</span>`;
}

export function formatJenkinsAlertMessage(payload: JenkinsWebhookPayload): string {
  const lines: string[] = [];
  const mentionHtmlList = payload.mentionHtmlList?.filter(Boolean) ?? [];
  const statusText = deriveStatusText(payload);
  const headline = deriveHeadline(payload);
  const failureReason = normalizeWhitespace(payload.failureReason || '');
  const failedStageText = normalizeWhitespace(payload.failedStage || '');

  if (mentionHtmlList.length > 0) {
    lines.push(mentionHtmlList.join(' '));
    lines.push('');
  }

  const buildUrl = safeHttpUrl(payload.buildUrl);
  if (buildUrl) {
    lines.push(
      `<strong>Build URL:</strong> <a href="${escapeHtml(buildUrl)}">Click Here (#${escapeHtml(payload.buildNumber)})</a>`,
    );
  } else {
    lines.push(`<strong>Build URL:</strong> ${escapeHtml(payload.buildUrl)} (#${escapeHtml(payload.buildNumber)})`);
  }
  lines.push(`<strong>Status:</strong> ${escapeHtml(statusText)}`);
  lines.push('');

  const prUrl = safeHttpUrl(payload.prUrl);
  if (prUrl) {
    lines.push(`<strong>Branch:</strong> <a href="${escapeHtml(prUrl)}">${escapeHtml(payload.branch)}</a>`);
  } else {
    lines.push(`<strong>Branch:</strong> ${escapeHtml(payload.branch)}`);
  }

  lines.push(`<strong>Contributor:</strong> ${escapeHtml(payload.contributor)}`);

  if (failedStageText && failedStageText !== 'N/A') {
    lines.push(`<strong>Stage:</strong> ${escapeHtml(failedStageText)}`);
  }

  if (failureReason) {
    lines.push('');
    lines.push(`<strong>Reason:</strong> ${escapeHtml(failureReason)}`);
  }

  lines.push('');
  lines.push('<strong>Message:</strong>');
  lines.push(escapeHtml(headline));

  if (payload.testsTotal !== undefined && payload.testsTotal > 0) {
    const passRate = payload.testsTotal
      ? Math.min(Math.round(((payload.testsPassed || 0) / payload.testsTotal) * 100), 100)
      : 0;
    let testSummary = `<strong>Tests:</strong> ${payload.testsPassed || 0}/${payload.testsTotal} passed (${passRate}%)`;

    if (payload.testsFailed && payload.testsFailed > 0) {
      testSummary += ` • ${payload.testsFailed} failed`;
    }

    if (payload.testsSkipped && payload.testsSkipped > 0) {
      testSummary += ` • ${payload.testsSkipped} skipped`;
    }

    lines.push('');
    lines.push(testSummary);
  }

  const cucumberReportUrl = safeHttpUrl(payload.cucumberReportUrl);
  if (cucumberReportUrl) {
    lines.push(`<a href="${escapeHtml(cucumberReportUrl)}">View Test Report</a>`);
  }

  return lines.join('<br/>');
}
