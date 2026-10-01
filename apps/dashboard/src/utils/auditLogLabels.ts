/** camelCase column name -> "Camel Case". */
export const humanizeField = (field: string): string =>
  field
    .replace(/([A-Z])/g, ' $1')
    .replace(/^./, char => char.toUpperCase())
    .trim();

/** Column names that don't humanize well, worded like the settings screens. */
const FIELD_LABELS: Record<string, string> = {
  roleId: 'Role',
  userGroupId: 'User group',
  subCategory: 'Sub-category',
  ownerUserId: 'Inbox owner',
  sendAsEmail: 'Send-as alias',
  dlEmail: 'Distribution list',
  dlAliases: 'Additional inbound addresses',
  defaultCc: 'Default CC',
  assigneeUserGroupId: 'Default assignee group',
  boardId: 'Board',
  twoStepSendEnabled: 'Two-step send',
  emailMergeMode: 'Auto-merge similar emails',
  appWebhookDeliveryEnabled: 'Send replies to app webhook',
  duplicateScopeConfig: 'Limit duplicate detection by field',
  autoDraftMode: 'Auto AI draft',
  autoDraftAgentSlug: 'Draft agent',
  deskReportEnabled: 'Desk report',
  deskReportAgentSlug: 'Desk report agent',
  deskReportRangeDays: 'Report window',
  classificationEnabled: 'Auto-classification',
  categoryField: 'Category field',
  subCategoryField: 'Sub-category field',
  classificationPrompt: 'Classification prompt',
  priorityClassificationEnabled: 'AI priority detection',
  priorityClassificationThreshold: 'Confidence threshold',
  priorityClassificationPrompt: 'Priority prompt',
  metricsEnabled: 'Desk metrics',
  frtStageNames: 'First response stops at',
  metricsGuestVisibility: 'Guest visibility',
};

/** Label for a change row's field; JSON paths label each segment, e.g. "Metadata › Sla Policy Type". */
export const fieldLabel = (field: string): string =>
  field
    .split('.')
    .map(segment => FIELD_LABELS[segment] ?? humanizeField(segment))
    .join(' › ');
