export interface User {
  id: string;
  email: string;
  displayName: string | null;
  avatarUrl: string | null;
}

export interface Conversation {
  id: string;
  otherUser: User;
  lastMessagePreview: string | null;
  lastMessageAt: string | null;
  createdAt: string;
}

export type MessageType = "text" | "file";

export interface ChatMessage {
  id: string;
  conversationId: string;
  senderId: string;
  type: MessageType;
  content?: string;
  fileName?: string;
  driveFileId?: string;
  shareLink?: string;
  timestamp: string;
}

export type SyncStatus = "synced" | "failed";
