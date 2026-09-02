import { apiInstance } from './clients/apiClient';

export type MonthlyMode = 'DAY_OF_MONTH' | 'NTH_WEEKDAY';

// Fields shared by create/update payloads for the recurrence.
// Monthly is signalled by daysOfWeek === "-"; monthlyValue packs the schedule
// (DAY_OF_MONTH: 1..28 or -1=last day; NTH_WEEKDAY: ordinal*10 + weekday).
export interface SchedulePayloadFields {
  daysOfWeek?: string; // weekly: "0,1,2,3,4,5,6" (0=Sun...6=Sat); "-" = monthly
  monthlyMode?: MonthlyMode;
  monthlyValue?: number;
}

export interface ScheduledMessage {
  id: string;
  title: string;
  messageContent: string;
  channelId: string;
  daysOfWeek: string;
  monthlyMode: MonthlyMode | null;
  monthlyValue: number | null;
  scheduledTime: string;
  isActive: boolean;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  canEdit: boolean;
}

export interface CreateScheduledMessagePayload extends SchedulePayloadFields {
  channelId: string;
  title: string;
  messageContent: string;
  scheduledTime: string;
}

export interface UpdateScheduledMessagePayload extends Partial<SchedulePayloadFields> {
  title?: string;
  messageContent?: string;
  scheduledTime?: string;
  isActive?: boolean;
}

export const scheduledMessageApi = {
  list: async (): Promise<ScheduledMessage[]> => {
    const response = await apiInstance.get<{ scheduledMessages: ScheduledMessage[] }>(
      '/scheduled-messages',
    );
    return response.data.scheduledMessages;
  },

  create: async (payload: CreateScheduledMessagePayload): Promise<ScheduledMessage> => {
    const response = await apiInstance.post<{ scheduledMessage: ScheduledMessage }>(
      '/scheduled-messages',
      payload,
    );
    return response.data.scheduledMessage;
  },

  update: async (id: string, payload: UpdateScheduledMessagePayload): Promise<ScheduledMessage> => {
    const response = await apiInstance.put<{ scheduledMessage: ScheduledMessage }>(
      `/scheduled-messages/${id}`,
      payload,
    );
    return response.data.scheduledMessage;
  },

  delete: async (id: string): Promise<void> => {
    await apiInstance.delete(`/scheduled-messages/${id}`);
  },
};
