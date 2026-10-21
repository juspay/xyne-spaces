import { apiPost, isMtlsRequestError } from './apiClient';
import { buildAuthenticatedHeaders } from './authToken';

export type ToggleAssignmentAvailabilityResponse = {
  success: true;
  message: string;
  unavailableUntil?: number;
  userGroupIds: string[];
  groupCount: number;
};

type ToggleAssignmentAvailabilityRequest =
  | {
      isUnavailable: true;
      unavailableUntil: number;
    }
  | {
      isUnavailable: false;
    };

const parseBackendMessage = (body: string): string => {
  try {
    const parsed = JSON.parse(body) as { error?: unknown; message?: unknown };
    const message = parsed.error ?? parsed.message;
    return typeof message === 'string' ? message : '';
  } catch {
    return body;
  }
};

export const assignmentAvailabilityErrorMessage = (error: unknown): string => {
  if (!isMtlsRequestError(error)) {
    return 'Could not update assignment availability. Try again.';
  }

  const backendMessage = parseBackendMessage(error.responseBody);
  if (error.statusCode === 401) {
    return 'Sign in again to update assignment availability.';
  }
  if (error.statusCode === 400) {
    if (backendMessage.includes('select a time')) {
      return 'Select when you will be available again.';
    }
    if (backendMessage.includes('valid value')) {
      return 'Choose a valid return time.';
    }
    if (backendMessage.includes('future time')) {
      return 'Choose a future return time.';
    }
  }

  return 'Could not update assignment availability. Try again.';
};

export async function toggleAssignmentAvailability(
  request: ToggleAssignmentAvailabilityRequest,
): Promise<ToggleAssignmentAvailabilityResponse> {
  const headers = await buildAuthenticatedHeaders();
  return apiPost<ToggleAssignmentAvailabilityResponse>('/user-assignment-state/toggle', request, {
    headers,
  });
}
