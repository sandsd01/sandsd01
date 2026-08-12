import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api } from "../api/client";
import { useAuth } from "../context/AuthContext";
import { useSocket } from "../context/SocketContext";
import type { ChatMessage, SyncStatus } from "../types";
import MessageBubble from "../components/MessageBubble";
import MessageInput from "../components/MessageInput";
import { uploadAttachment } from "../lib/googleDrive";

export default function ChatRoomPage() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const { socket } = useSocket();
  const navigate = useNavigate();

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [participants, setParticipants] = useState<string[]>([]);
  const [syncStatus, setSyncStatus] = useState<Record<string, SyncStatus>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    api
      .conversationHistory(id)
      .then((data) => {
        setMessages(data.messages);
        setParticipants(data.participants);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [id]);

  useEffect(() => {
    if (!socket) return;

    function onReceive({ conversationId, message }: { conversationId: string; message: ChatMessage }) {
      if (conversationId !== id) return;
      setMessages((prev) => [...prev, message]);
    }

    function onSyncStatus({ messageId, status }: { messageId: string; status: SyncStatus }) {
      setSyncStatus((prev) => ({ ...prev, [messageId]: status }));
    }

    socket.on("message:receive", onReceive);
    socket.on("sync:status", onSyncStatus);
    return () => {
      socket.off("message:receive", onReceive);
      socket.off("sync:status", onSyncStatus);
    };
  }, [socket, id]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  function sendText(content: string) {
    if (!socket || !id) return;
    socket.emit("message:send", { conversationId: id, type: "text", content });
  }

  async function sendFile(file: File) {
    if (!socket || !id) return;
    try {
      const { accessToken, driveFolderId } = await api.driveToken();
      const { driveFileId, shareLink, fileName } = await uploadAttachment(file, { accessToken, driveFolderId });
      socket.emit("message:send", { conversationId: id, type: "file", fileName, driveFileId, shareLink });
    } catch (err) {
      setError(err instanceof Error ? err.message : "File upload failed");
    }
  }

  const otherEmail = participants.find((p) => p !== user?.email);

  return (
    <div className="mx-auto flex h-screen max-w-2xl flex-col bg-white">
      <header className="flex items-center gap-3 border-b border-slate-200 p-4">
        <button onClick={() => navigate("/")} className="text-slate-500 hover:text-slate-800">
          ←
        </button>
        <p className="font-semibold text-slate-900">{otherEmail || "Conversation"}</p>
      </header>

      {error && <p className="px-4 pt-2 text-sm text-red-600">{error}</p>}

      <div className="flex-1 overflow-y-auto p-4">
        {loading ? (
          <p className="text-sm text-slate-500">Loading history from Drive...</p>
        ) : (
          <div className="flex flex-col gap-2">
            {messages.map((m) => (
              <MessageBubble key={m.id} message={m} isOwn={m.senderId === user?.id} syncStatus={syncStatus[m.id]} />
            ))}
            <div ref={bottomRef} />
          </div>
        )}
      </div>

      <MessageInput onSendText={sendText} onSendFile={sendFile} />
    </div>
  );
}
