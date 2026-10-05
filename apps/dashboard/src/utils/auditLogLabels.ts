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
  deskAppIds: 'Desk apps',
  defaultCc: 'Default CC',
  assigneeUserGroupId: 'Default assignee group',
  boardId: 'Board',
  globalFieldId: 'Field',
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
  onCall: 'On call',
  isActiveForAssignment: 'Active',
  onCallMembers: 'On-call members',
  activeMembers: 'Active members',
};

/** Switch-like flags read as on/off rather than the stored true/false. */
const SWITCH_FIELDS = new Set(['onCall', 'isActiveForAssignment']);

/** Display form of a stored change value. */
export const formatAuditValue = (field: string, value: string | null): string | null => {
  if (value === null || !SWITCH_FIELDS.has(field)) return value;
  if (value === 'true') return 'on';
  if (value === 'false') return 'off';
  return value;
};

/** Label for a change row's field; JSON paths label each segment, e.g. "Metadata › Sla Policy Type". */
export const fieldLabel = (field: string): string =>
  field
    .split('.')
    .map(segment => FIELD_LABELS[segment] ?? humanizeField(segment))
    .join(' › ');
