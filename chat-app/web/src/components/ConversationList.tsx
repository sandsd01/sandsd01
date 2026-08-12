import { Link } from "react-router-dom";
import type { Conversation } from "../types";
import PresenceDot from "./PresenceDot";

export default function ConversationList({
  conversations,
  onlineUserIds,
}: {
  conversations: Conversation[];
  onlineUserIds: Set<string>;
}) {
  if (conversations.length === 0) {
    return <p className="p-4 text-sm text-slate-500">No conversations yet. Start one above.</p>;
  }

  return (
    <ul className="flex-1 divide-y divide-slate-100 overflow-y-auto">
      {conversations.map((c) => (
        <li key={c.id}>
          <Link to={`/chat/${c.id}`} className="flex items-center gap-3 p-4 hover:bg-slate-50">
            <div className="relative">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-200 text-sm font-medium text-slate-600">
                {(c.otherUser.displayName || c.otherUser.email)[0]?.toUpperCase()}
              </div>
              <PresenceDot online={onlineUserIds.has(c.otherUser.id)} className="absolute -bottom-0.5 -right-0.5" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium text-slate-900">{c.otherUser.displayName || c.otherUser.email}</p>
              <p className="truncate text-sm text-slate-500">{c.lastMessagePreview || "No messages yet"}</p>
            </div>
          </Link>
        </li>
      ))}
    </ul>
  );
}
