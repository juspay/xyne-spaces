import { apiInstance } from '../clients/apiClient';

// Connection status for the mailbox behind a PERSONAL SEND_EMAIL_TO_USER step.
// Connecting is the recap composer's flow: recordingEmailService.connectGoogle.

export interface PersonalEmailStatus {
  connected: boolean;
  /** Whether the viewer is the automation's author — only they can grant consent. */
  isOwner: boolean;
  /** The connected address, or the address that would have to be connected. */
  email: string | null;
}

class PersonalEmailService {
  /** `automationId` reports on that automation's author; omitted means the caller. */
  async getStatus(automationId?: string): Promise<PersonalEmailStatus> {
    const response = await apiInstance.get<PersonalEmailStatus>(
      '/integrations/google/connect/personal-email/status',
      automationId ? { params: { automationId } } : undefined,
    );
    return response.data;
  }
}

export const personalEmailService = new PersonalEmailService();
