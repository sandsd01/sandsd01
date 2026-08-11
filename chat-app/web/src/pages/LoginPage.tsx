import { useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { api } from "../api/client";
import { useAuth } from "../context/AuthContext";

// Doubles as the OAuth redirect target: GOOGLE_REDIRECT_URI (server .env)
// must point here so ?code=... from Google lands on this page.
export default function LoginPage() {
  const { user, loginWithCode } = useAuth();
  const [params] = useSearchParams();
  const navigate = useNavigate();

  useEffect(() => {
    const code = params.get("code");
    if (code) {
      loginWithCode(code)
        .then(() => navigate("/", { replace: true }))
        .catch((err) => console.error("Login failed:", err));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params]);

  useEffect(() => {
    if (user) navigate("/", { replace: true });
  }, [user, navigate]);

  async function handleLogin() {
    const { url } = await api.getGoogleAuthUrl();
    window.location.href = url;
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50">
      <div className="w-full max-w-sm rounded-xl bg-white p-8 text-center shadow">
        <h1 className="mb-2 text-2xl font-semibold text-slate-900">Chat</h1>
        <p className="mb-6 text-sm text-slate-500">Your messages are archived to your own Google Drive.</p>
        <button
          onClick={handleLogin}
          className="w-full rounded-lg bg-slate-900 px-4 py-2.5 font-medium text-white hover:bg-slate-800"
        >
          Sign in with Google
        </button>
      </div>
    </div>
  );
}
