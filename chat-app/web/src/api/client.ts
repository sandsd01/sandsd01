import type { Conversation, ChatMessage } from "../types";

const API_BASE = import.meta.env.VITE_API_BASE_URL || "http://localhost:4000";

let onUnauthorized: (() => void) | null = null;

export function setOnUnauthorized(handler: () => void) {
  onUnauthorized = handler;
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = localStorage.getItem("chat_token");
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options.headers as Record<string, string>),
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(`${API_BASE}${path}`, { ...options, headers });

  if (res.status === 401 && token) {
    onUnauthorized?.();
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Request failed: ${res.status}`);
  }

  if (res.status === 204) return undefined as T;
  return res.json();
}

interface AuthResponse {
  token: string;
  user: { id: string; email: string; displayName: string; avatarUrl: string };
}

export const api = {
  getGoogleAuthUrl: () => request<{ url: string }>("/auth/google/url"),
  googleCallback: (code: string) =>
    request<AuthResponse>("/auth/google/callback", { method: "POST", body: JSON.stringify({ code }) }),
  me: () => request<{ id: string; email: string; displayName: string; avatarUrl: string }>("/me"),
  driveToken: () => request<{ accessToken: string; expiresAt: number; driveFolderId: string }>("/me/drive-token"),
  conversations: () => request<Conversation[]>("/conversations"),
  startConversation: (email: string) =>
    request<{ id: string }>("/conversations", { method: "POST", body: JSON.stringify({ email }) }),
  conversationHistory: (id: string) =>
    request<{ conversationId: string; participants: string[]; messages: ChatMessage[] }>(
      `/conversations/${id}/history`
    ),
};

export { API_BASE };
