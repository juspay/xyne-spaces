import { CreateWorkflowRequest } from '../../services/Workflow/workflowService';

/**
 * Validate ticket creation request with dynamic field support
 */
export const validateTicketRequest = (
  data: Record<string, unknown>,
): {
  isValid: boolean;
  errors: string[];
} => {
  const errors: string[] = [];

  if (typeof data['title'] !== 'string' || data['title'].trim() === '') {
    errors.push('Title is required');
  }

  if (!data['workflowType'] || typeof data['workflowType'] !== 'string') {
    errors.push('Workflow type is required');
  }

  if (typeof data['title'] === 'string' && data['title'].length > 255) {
    errors.push('Title must be 255 characters or less');
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
};

/**
 * Build ticket creation request from typed form data
 */
export const buildTicketRequest = (
  workflowType: string,
  formData: Record<string, unknown>,
): CreateWorkflowRequest => {
  const title = formData['title'] as string;

  const request: CreateWorkflowRequest = {
    title,
    workflowType,
  };

  Object.entries(formData).forEach(([key, value]) => {
    if (key !== 'title') {
      request[key] = value;
    }
  });

  return request;
};

// ETA Utility Functions
export const formatETADisplay = (eta: number | null | undefined): string => {
  if (!eta) return '—';
  const date = new Date(eta);

  const day = date.getDate();
  const month = date.getMonth();
  const hours = date.getHours();
  const minutes = date.getMinutes();
  const period = hours >= 12 ? 'PM' : 'AM';
  const displayHours = hours % 12 || 12;
  const displayMinutes = minutes.toString().padStart(2, '0');

  const monthNames = [
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'May',
    'Jun',
    'Jul',
    'Aug',
    'Sep',
    'Oct',
    'Nov',
    'Dec',
  ];

  return `${day} ${monthNames[month]}, ${displayHours}:${displayMinutes} ${period}`;
};

export const getLocalISOString = (timestamp: number): string => {
  const date = new Date(timestamp);
  const offset = date.getTimezoneOffset() * 60000;
  const localDate = new Date(date.getTime() - offset);
  return localDate.toISOString().slice(0, 16);
};
