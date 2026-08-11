import { useEffect, useState, FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api/client";
import { useAuth } from "../context/AuthContext";
import { useSocket } from "../context/SocketContext";
import type { Conversation } from "../types";
import ConversationList from "../components/ConversationList";

export default function ConversationsPage() {
  const { user, logout } = useAuth();
  const { onlineUserIds } = useSocket();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    api.conversations().then(setConversations).catch((err) => setError(err.message));
  }, []);

  async function handleStartConversation(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const { id } = await api.startConversation(email);
      navigate(`/chat/${id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start conversation");
    }
  }

  return (
    <div className="mx-auto flex h-screen max-w-2xl flex-col bg-white">
      <header className="flex items-center justify-between border-b border-slate-200 p-4">
        <div>
          <p className="font-semibold text-slate-900">{user?.displayName}</p>
          <p className="text-xs text-slate-500">{user?.email}</p>
        </div>
        <button onClick={logout} className="text-sm text-slate-500 hover:text-slate-800">
          Sign out
        </button>
      </header>

      <form onSubmit={handleStartConversation} className="flex gap-2 border-b border-slate-200 p-4">
        <input
          type="email"
          required
          placeholder="Start a chat with an email..."
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm"
        />
        <button type="submit" className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white">
          Start
        </button>
      </form>
      {error && <p className="px-4 pt-2 text-sm text-red-600">{error}</p>}

      <ConversationList conversations={conversations} onlineUserIds={onlineUserIds} />
    </div>
  );
}
