export interface CallChatMessage {
  id: string;
  callId: string;
  participantId: string;
  message: string;
  createdAt: string;
  displayName: string;
  isExternal: boolean;
}

export interface CallChatHistoryResponse {
  success: boolean;
  messages: CallChatMessage[];
  hasExternalMessages: boolean;
}
