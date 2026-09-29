import React, { useState } from "react";

interface ForgotPasswordViewProps {
  onBackToLogin: () => void;
}

export const ForgotPasswordView: React.FC<ForgotPasswordViewProps> = ({ onBackToLogin }) => {
	const [email, setEmail] = useState("");
	const [sentTo, setSentTo] = useState("");
	const [error, setError] = useState("");
	const [loading, setLoading] = useState(false);

	const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
		e.preventDefault();
		setError("");
		setLoading(true);

		try {
			const res = await fetch("/api/auth/forgot-password", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ email }),
			});
			const data = (await res.json()) as { message?: string; error?: string };
			if (!res.ok || data.error) {
				setError(data.error || "Something went wrong. Please try again.");
			} else {
				setSentTo(email);
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
          Reset Password
        </button>
      </nav>

		<main className="bg-white rounded-2xl p-5 sm:p-6">
			{sentTo ? (
				<div className="text-center py-4">
					<div className="text-4xl mb-3">📩</div>
					<h2 className="text-base font-bold text-slate-900 mb-1">Check your email!</h2>
					<p className="text-sm text-slate-600 mb-1">
						We sent a password reset link to <strong>{sentTo}</strong>.
					</p>
					<p className="text-xs text-slate-400 mb-4">
						Open the email and tap the <strong>Reset password</strong> button. The link works for 1 hour and can be used only once. Can't find it? Check your spam folder.
					</p>
					<button
						type="button"
						onClick={onBackToLogin}
						className="w-full py-3 rounded-xl border-none bg-blue-600 text-white text-sm font-semibold cursor-pointer hover:opacity-90 transition"
					>
						Back to Sign in
					</button>
				</div>
			) : (
			<>
			<h2 className="text-base font-bold text-slate-900 mb-1">Forgot password?</h2>
			<p className="text-xs text-slate-400 mb-4">
				Enter your account email and we'll send you a reset link (valid for 1 hour).
			</p>

			<form onSubmit={handleSubmit}>
				<label htmlFor="fp-email" className="block text-xs font-semibold text-slate-600 mb-1.5">
					Email
				</label>
				<input
					type="email"
					id="fp-email"
					value={email}
					onChange={(e: React.ChangeEvent<HTMLInputElement>) => setEmail(e.target.value)}
					placeholder="you@example.com"
					required
					autoComplete="email"
					className="w-full px-3.5 py-2.5 rounded-xl border-none bg-slate-100 text-sm outline-none mb-4"
				/>

				<button
					type="submit"
					disabled={loading}
					className="w-full py-3 rounded-xl border-none bg-blue-600 text-white text-sm font-semibold cursor-pointer hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition"
				>
					{loading ? "Sending..." : "Send Reset Link"}
				</button>
			</form>

			{error && <div className="msg msg-error show mt-3.5 p-3 rounded-xl text-sm">{error}</div>}

			<p className="mt-4 text-center text-xs text-slate-400">
				Remembered your password?{" "}
				<button type="button" onClick={onBackToLogin} className="text-blue-600 font-semibold border-none bg-transparent cursor-pointer">
					Sign in
				</button>
			</p>
			</>
			)}
		</main>
    </div>
  );
};
