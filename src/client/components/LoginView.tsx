import React, { useState } from "react";

interface LoginViewProps {
  onLoginSuccess: () => void;
  onSwitchToRegister: () => void;
}

export const LoginView: React.FC<LoginViewProps> = ({ onLoginSuccess, onSwitchToRegister }) => {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok || data.error) {
        setError(data.error || "Login failed");
      } else {
        onLoginSuccess();
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
          className="px-4 py-2 rounded-xl text-sm font-medium border-none bg-blue-600 text-white cursor-pointer"
        >
          Login
        </button>
        <button
          type="button"
          onClick={onSwitchToRegister}
          className="px-4 py-2 rounded-xl text-sm font-medium border-none bg-white text-slate-400 hover:bg-slate-100 transition cursor-pointer"
        >
          Register
        </button>
      </nav>

      <main className="bg-white rounded-2xl p-5 sm:p-6">
        <form onSubmit={handleSubmit}>
          <label htmlFor="email" className="block text-xs font-semibold text-slate-600 mb-1.5">
            Email
          </label>
          <input
            type="email"
            id="email"
            value={email}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setEmail(e.target.value)}
            placeholder="you@example.com"
            required
            autoComplete="email"
            className="w-full px-3.5 py-2.5 rounded-xl border-none bg-slate-100 text-sm outline-none mb-4"
          />

          <label htmlFor="password" className="block text-xs font-semibold text-slate-600 mb-1.5">
            Password
          </label>
          <input
            type="password"
            id="password"
            value={password}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setPassword(e.target.value)}
            placeholder="Min 6 characters"
            required
            minLength={6}
            autoComplete="current-password"
            className="w-full px-3.5 py-2.5 rounded-xl border-none bg-slate-100 text-sm outline-none mb-4"
          />

          <button
            type="submit"
            disabled={loading}
            className="w-full py-3 rounded-xl border-none bg-blue-600 text-white text-sm font-semibold cursor-pointer hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition"
          >
            {loading ? "Signing In..." : "Sign In"}
          </button>
        </form>

        {error && <div className="msg msg-error show mt-3.5 p-3 rounded-xl text-sm">{error}</div>}

        <p className="mt-4 text-center text-xs text-slate-400">
          Don't have an account?{" "}
          <button type="button" onClick={onSwitchToRegister} className="text-blue-600 font-semibold border-none bg-transparent cursor-pointer">
            Register
          </button>
        </p>
      </main>
    </div>
  );
};
