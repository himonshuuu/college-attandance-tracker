import React, { useEffect, useState } from "react";

interface ResetPasswordViewProps {
  token: string;
  onBackToLogin: () => void;
}

export const ResetPasswordView: React.FC<ResetPasswordViewProps> = ({ token, onBackToLogin }) => {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [verifying, setVerifying] = useState(true);
  const [tokenValid, setTokenValid] = useState(false);
  const [verifyError, setVerifyError] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const verify = async () => {
      try {
        const res = await fetch(`/api/auth/reset-password?token=${encodeURIComponent(token)}`);
        const data = (await res.json()) as { valid?: boolean; error?: string };
        if (res.ok && data.valid) {
          setTokenValid(true);
        } else {
          setVerifyError(data.error || "This reset link is invalid or has expired.");
        }
      } catch {
        setVerifyError("Could not verify reset link. Please check your connection.");
      } finally {
        setVerifying(false);
      }
    };
    verify();
  }, [token]);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError("");
    if (password.length < 6) {
      setError("Password must be at least 6 characters.");
      return;
    }
    if (password !== confirm) {
      setError("Passwords do not match.");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password }),
      });
      const data = (await res.json()) as { message?: string; error?: string };
      if (!res.ok || data.error) {
        setError(data.error || "Could not reset password. Please request a new link.");
      } else {
        setSuccess(data.message || "Password has been reset. Please sign in.");
      }
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <nav className="flex gap-2 mb-6">
        <button
          type="button"
          onClick={onBackToLogin}
          className="px-4 py-2 rounded-xl text-sm font-medium border-none bg-white text-slate-400 hover:bg-slate-100 transition cursor-pointer"
        >
          Login
        </button>
        <button
          type="button"
          className="px-4 py-2 rounded-xl text-sm font-medium border-none bg-blue-600 text-white cursor-pointer"
        >
          New Password
        </button>
      </nav>

      <main className="bg-white rounded-2xl p-5 sm:p-6">
        <h2 className="text-base font-bold text-slate-900 mb-1">Set a new password</h2>

        {verifying && <p className="text-xs text-slate-400 mt-2">Verifying reset link...</p>}

        {!verifying && !tokenValid && (
          <>
            <div className="msg msg-error show mt-3.5 p-3 rounded-xl text-sm">{verifyError}</div>
            <button
              type="button"
              onClick={onBackToLogin}
              className="w-full mt-4 py-3 rounded-xl border-none bg-blue-600 text-white text-sm font-semibold cursor-pointer hover:opacity-90 transition"
            >
              Back to Sign In
            </button>
          </>
        )}

        {!verifying && tokenValid && !success && (
          <form onSubmit={handleSubmit} className="mt-3">
            <label htmlFor="np-password" className="block text-xs font-semibold text-slate-600 mb-1.5">
              New password
            </label>
            <input
              type="password"
              id="np-password"
              value={password}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setPassword(e.target.value)}
              placeholder="Min 6 characters"
              required
              minLength={6}
              autoComplete="new-password"
              className="w-full px-3.5 py-2.5 rounded-xl border-none bg-slate-100 text-sm outline-none mb-4"
            />

            <label htmlFor="np-confirm" className="block text-xs font-semibold text-slate-600 mb-1.5">
              Confirm new password
            </label>
            <input
              type="password"
              id="np-confirm"
              value={confirm}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setConfirm(e.target.value)}
              placeholder="Repeat new password"
              required
              minLength={6}
              autoComplete="new-password"
              className="w-full px-3.5 py-2.5 rounded-xl border-none bg-slate-100 text-sm outline-none mb-4"
            />

            <button
              type="submit"
              disabled={loading}
              className="w-full py-3 rounded-xl border-none bg-blue-600 text-white text-sm font-semibold cursor-pointer hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition"
            >
              {loading ? "Resetting..." : "Reset Password"}
            </button>
          </form>
        )}

        {error && <div className="msg msg-error show mt-3.5 p-3 rounded-xl text-sm">{error}</div>}
        {success && (
          <>
            <div className="msg msg-success show mt-3.5 p-3 rounded-xl text-sm">{success}</div>
            <button
              type="button"
              onClick={onBackToLogin}
              className="w-full mt-4 py-3 rounded-xl border-none bg-blue-600 text-white text-sm font-semibold cursor-pointer hover:opacity-90 transition"
            >
              Sign In
            </button>
          </>
        )}
      </main>
    </div>
  );
};
