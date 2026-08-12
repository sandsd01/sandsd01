import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { io, Socket } from "socket.io-client";
import { API_BASE } from "../api/client";
import { useAuth } from "./AuthContext";

interface SocketContextValue {
  socket: Socket | null;
  onlineUserIds: Set<string>;
}

const SocketContext = createContext<SocketContextValue>({ socket: null, onlineUserIds: new Set() });

export function SocketProvider({ children }: { children: ReactNode }) {
  const { token } = useAuth();
  const [socket, setSocket] = useState<Socket | null>(null);
  const [onlineUserIds, setOnlineUserIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!token) {
      setSocket(null);
      return;
    }

    const s = io(API_BASE, { auth: { token } });
    s.on("connect", () => s.emit("presence:online"));
    s.on("presence:update", ({ userId, isOnline }: { userId: string; isOnline: boolean }) => {
      setOnlineUserIds((prev) => {
        const next = new Set(prev);
        if (isOnline) next.add(userId);
        else next.delete(userId);
        return next;
      });
    });
    setSocket(s);

    return () => {
      s.disconnect();
    };
  }, [token]);

  return <SocketContext.Provider value={{ socket, onlineUserIds }}>{children}</SocketContext.Provider>;
}

export function useSocket() {
  return useContext(SocketContext);
}
