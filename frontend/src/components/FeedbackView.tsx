import React, { useState } from "react";
import { navigate, PATHS } from "../router";

interface FeedbackResponse {
	success?: boolean;
	message?: string;
	error?: string;
	rating?: number;
}

const RATING_LABELS: Record<number, string> = {
	1: "Very poor",
	2: "Poor",
	3: "Okay",
	4: "Good",
	5: "Great",
};

export const FeedbackView: React.FC<{ onBack?: () => void }> = ({ onBack }) => {
	const [rating, setRating] = useState(0);
	const [message, setMessage] = useState("");
	const [name, setName] = useState("");
	const [submitting, setSubmitting] = useState(false);
	const [success, setSuccess] = useState("");
	const [error, setError] = useState("");

	const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		setError("");
		setSuccess("");

		if (rating < 1) {
			setError("Please pick a rating out of 5.");
			return;
		}
		if (message.trim().length < 5) {
			setError("Please write at least a few words.");
			return;
		}
		if (!name.trim()) {
			setError("Please enter your name.");
			return;
		}

		setSubmitting(true);
		try {
			const res = await fetch("/api/feedback", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ rating, message: message.trim(), name: name.trim() }),
			});
			const data = (await res.json()) as FeedbackResponse;
			if (!res.ok || !data.success) {
				setError(data.error || "Could not send your feedback. Try again.");
			} else {
				setSuccess(data.message || "Thanks! Your feedback was recorded.");
				setRating(0);
				setMessage("");
				setName("");
			}
		} catch {
			setError("Network error. Please try again.");
		} finally {
			setSubmitting(false);
		}
	};

	return (
		<div className="bg-white rounded-2xl p-5 sm:p-6">
			<p className="text-sm text-slate-500 mb-4">
				Attendance Monitor is going on a break until the next semester starts.
				Tell us what worked, what did not, and what you want next — it all goes
				straight to the developer.
			</p>

			<form onSubmit={handleSubmit}>
				<label className="block text-xs font-semibold text-slate-600 mb-2">
					How is Attendance Monitor so far?
				</label>

				<div className="flex items-center gap-2 mb-1">
					{[1, 2, 3, 4, 5].map((star) => (
						<button
							key={star}
							type="button"
							aria-label={`${star} out of 5 — ${RATING_LABELS[star]}`}
							onClick={() => setRating(star)}
							className="p-1 border-none bg-transparent cursor-pointer min-h-[44px] min-w-[44px] flex items-center justify-center"
						>
							<svg
								xmlns="http://www.w3.org/2000/svg"
								className="w-8 h-8 transition-colors"
								viewBox="0 0 24 24"
								fill={star <= rating ? "#f59e0b" : "none"}
								stroke={star <= rating ? "#f59e0b" : "#cbd5e1"}
								strokeWidth="2"
								strokeLinecap="round"
								strokeLinejoin="round"
								aria-hidden="true"
							>
								<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
							</svg>
						</button>
					))}
					<span className="text-xs text-slate-400 ml-1">
						{rating > 0 ? `${rating}/5 — ${RATING_LABELS[rating]}` : "Tap to rate"}
					</span>
				</div>

				<label className="block text-xs font-semibold text-slate-600 mt-4 mb-2">
					Your feedback
				</label>
				<textarea
					value={message}
					onChange={(e) => setMessage(e.target.value)}
					rows={6}
					maxLength={2000}
					placeholder="What did you like? What should we fix or add next semester?"
					className="w-full p-3 rounded-xl border border-slate-200 text-sm resize-y focus:outline-none focus:border-blue-500"
				/>
				<p className="text-xs text-slate-400 -mt-1">
					{message.length}/2000 characters
				</p>

				<label className="block text-xs font-semibold text-slate-600 mt-4 mb-2">
					Your name
				</label>
				<input
					type="text"
					value={name}
					onChange={(e) => setName(e.target.value)}
					maxLength={80}
					required
					placeholder="Required — so we know who sent it"
					className="w-full p-3 rounded-xl border border-slate-200 text-sm focus:outline-none focus:border-blue-500"
				/>

				<button
					type="submit"
					disabled={submitting}
					className="w-full py-3 rounded-xl border-none bg-blue-600 text-white text-sm font-semibold cursor-pointer mt-5 hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition"
				>
					{submitting ? "Sending..." : "Send feedback"}
				</button>
			</form>

			{success && (
				<div className="msg msg-success show mt-3.5 p-3 rounded-xl text-sm">
					{success}
				</div>
			)}
			{error && (
				<div className="msg msg-error show mt-3.5 p-3 rounded-xl text-sm">
					{error}
				</div>
			)}

			<button
				type="button"
				onClick={() => (onBack ? onBack() : navigate(PATHS.login))}
				className="w-full py-2.5 mt-3 rounded-xl border border-slate-200 bg-white text-slate-500 text-sm font-medium cursor-pointer min-h-[44px] hover:bg-slate-50 transition"
			>
				{onBack ? "Back to app" : "Back to sign in"}
			</button>
		</div>
	);
};
