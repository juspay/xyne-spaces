export const CREATE_TICKET_URL_FLAG = 'ct';

export const CREATE_TICKET_PARAM_KEYS = {
  priority: 'ct_priority',
  status: 'ct_status',
  boardId: 'ct_board',
  assignee: 'ct_assignee',
  eta: 'ct_eta',
  tag: 'ct_tag',
  workflowType: 'ct_workflow',
} as const;

export const CREATE_TICKET_FIELD_PARAM_KEYS: readonly string[] =
  Object.values(CREATE_TICKET_PARAM_KEYS);
