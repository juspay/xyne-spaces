// Reaction API Response Types
// These types define the structure of API responses from the reaction endpoints

// User info interface for reactions
export interface ApiReactionUser {
  userId: string;
  name: string;
  email?: string;
}

// Message reaction structure for API responses
export interface ApiMessageReaction {
  emojiName: string;
  count: number;
  userHasReacted: boolean;
  users: ApiReactionUser[];
}

// API Response Types for each endpoint

// POST /messages/:messageId/reactions/:emoji/toggle
// POST /messages/:messageId/reactions/:emoji
// DELETE /messages/:messageId/reactions/:emoji
export interface ReactionResponse {
  success: boolean;
  message?: string;
  added?: boolean;
  reactions: ApiMessageReaction[];
}

// GET /messages/:messageId/reactions
export interface GetReactionsResponse {
  reactions: ApiMessageReaction[];
}

// POST /messages/reactions/bulk
export interface BulkReactionsResponse {
  success: boolean;
  reactions: Record<string, ApiMessageReaction[]>; // messageId -> reactions
}