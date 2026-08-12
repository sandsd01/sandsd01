import { Navigate, Route, Routes } from "react-router-dom";
import { useAuth } from "./context/AuthContext";
import { SocketProvider } from "./context/SocketContext";
import LoginPage from "./pages/LoginPage";
import ConversationsPage from "./pages/ConversationsPage";
import ChatRoomPage from "./pages/ChatRoomPage";

function RequireAuth({ children }: { children: JSX.Element }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="p-8 text-center text-slate-500">Loading...</div>;
  if (!user) return <Navigate to="/login" replace />;
  return children;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        path="/*"
        element={
          <RequireAuth>
            <SocketProvider>
              <Routes>
                <Route path="/" element={<ConversationsPage />} />
                <Route path="/chat/:id" element={<ChatRoomPage />} />
              </Routes>
            </SocketProvider>
          </RequireAuth>
        }
      />
    </Routes>
  );
}
