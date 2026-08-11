import type { ChatMessage, SyncStatus } from "../types";

export default function MessageBubble({
  message,
  isOwn,
  syncStatus,
}: {
  message: ChatMessage;
  isOwn: boolean;
  syncStatus?: SyncStatus;
}) {
  return (
    <div className={`flex ${isOwn ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-xs rounded-2xl px-4 py-2 text-sm ${
          isOwn ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-900"
        }`}
      >
        {message.type === "text" ? (
          <p className="whitespace-pre-wrap">{message.content}</p>
        ) : (
          <a
            href={message.shareLink}
            target="_blank"
            rel="noreferrer"
            className={`underline ${isOwn ? "text-white" : "text-slate-900"}`}
          >
            📎 {message.fileName}
          </a>
        )}
        <div
          className={`mt-1 flex items-center justify-end gap-1 text-[10px] ${
            isOwn ? "text-slate-300" : "text-slate-400"
          }`}
        >
          <span>{new Date(message.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
          {isOwn && syncStatus && (
            <span title={syncStatus === "synced" ? "Saved to Drive" : "Drive sync failed"}>
              {syncStatus === "synced" ? "✓✓" : "!"}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
