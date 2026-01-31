import { apiInstance } from '../clients/apiClient';

export interface NativePushRegistrationPayload {
  token: string;
  voipToken?: string;
  platform?: 'ios' | 'android' | 'unknown';
  deviceId?: string;
  sessionId?: string | null;
}

export const registerNativePushToken = async (
  payload: NativePushRegistrationPayload,
): Promise<void> => {
  await apiInstance.post('/notifications/mobile/register', payload);
};

export const unregisterNativePushToken = async (): Promise<void> => {
  await apiInstance.post('/notifications/mobile/unregister', {});
};
