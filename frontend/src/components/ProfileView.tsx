import React, { useEffect, useState } from "react";

interface ProfileData {
	user: { email: string; enrollmentId: string; joinedAt: string };
	profile: {
		name: string;
		className: string;
		stream: string;
		rollNumber: string;
		profilePhotoUrl: string;
		subjects?: Array<{ label: string; value: string; courses: string[] }>;
	};
	subscriptions?: string[];
}

interface Badge {
	id: string;
	name: string;
	desc: string;
	icon: string;
	owned: boolean;
	isNew: boolean;
}

interface Overview {
	month: string;
	year: number;
	total: number;
	present: number;
	absent: number;
	pct: number;
	streak: { current: number; best: number };
	perfectWeeks: number;
	rank: number | null;
	totalStudents: number;
	badges: Badge[];
	headline: string;
	checksText: string;
	error?: string;
}

function initials(name: string): string {
	if (!name) return "S";
	return name
		.split(/\s+/)
		.map((w) => w[0])
		.slice(0, 2)
		.join("")
		.toUpperCase();
}

async function shareText(
	text: string,
): Promise<"shared" | "copied" | "failed"> {
	try {
		if (navigator.share) {
			await navigator.share({ title: "Attendance Monitor", text });
			return "shared";
		}
		await navigator.clipboard.writeText(text);
		return "copied";
	} catch {
		try {
			await navigator.clipboard.writeText(text);
			return "copied";
		} catch {
			return "failed";
		}
	}
}

export const ProfileView: React.FC = () => {
	const [data, setData] = useState<ProfileData | null>(null);
	const [overview, setOverview] = useState<Overview | null>(null);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState("");
	const [shareMsg, setShareMsg] = useState("");

	useEffect(() => {
		Promise.all([
			fetch("/api/profile").then(
				(r) => r.json() as Promise<ProfileData & { error?: string }>,
			),
			fetch("/api/engage/overview")
				.then((r) => r.json() as Promise<Overview>)
				.catch(() => null),
		])
			.then(([profileData, overviewData]) => {
				if (profileData.error) throw new Error(profileData.error);
				setData(profileData);
				if (overviewData && !overviewData.error) {
					setOverview(overviewData);
				}
			})
			.catch((err: Error) => setError(err.message))
			.finally(() => setLoading(false));
	}, []);

	const handleShare = async () => {
		if (!overview) return;
		setShareMsg("");
		const text =
			overview.streak.current >= 2
				? `I'm on a ${overview.streak.current}-class attendance streak (${overview.pct}% this month)! Can you beat it?`
				: `I'm at ${overview.pct}% attendance this month on Attendance Monitor. Join me!`;
		const result = await shareText(text);
		setShareMsg(
			result === "shared"
				? "Shared!"
				: result === "copied"
					? "Copied to clipboard!"
					: "Sharing not available on this device.",
		);
		window.setTimeout(() => setShareMsg(""), 3000);
	};

	if (loading) {
		return (
			<div className="text-center py-12 text-slate-400 text-sm">
				Loading profile...
			</div>
		);
	}

	if (error || !data) {
		return (
			<div className="text-center py-12 text-red-500 text-sm">
				{error || "Could not load profile"}
			</div>
		);
	}

	const { profile, user } = data;
	const joinedDate = user.joinedAt
		? new Date(user.joinedAt).toLocaleDateString()
		: "—";

	return (
		<div>
			<div className="bg-white rounded-2xl p-5 sm:p-6 mb-4">
				<div className="flex items-center gap-4 mb-5">
					<div className="w-16 h-16 rounded-full bg-blue-100 flex items-center justify-center shrink-0 overflow-hidden font-bold text-blue-600 text-xl">
						{profile.profilePhotoUrl ? (
							<img
								src={profile.profilePhotoUrl}
								alt={profile.name}
								className="w-full h-full object-cover"
							/>
						) : (
							initials(profile.name)
						)}
					</div>
					<div>
						<h2 className="text-lg font-bold text-slate-900">
							{profile.name || "—"}
						</h2>
						<p className="text-xs text-slate-400">{user.enrollmentId || "—"}</p>
					</div>
				</div>

				<div className="space-y-3">
					<div className="flex justify-between items-center py-2 border-b border-slate-100">
						<span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
							Email
						</span>
						<span className="text-sm font-medium text-slate-800">
							{user.email || "—"}
						</span>
					</div>
					<div className="flex justify-between items-center py-2 border-b border-slate-100">
						<span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
							Class
						</span>
						<span className="text-sm font-medium text-slate-800">
							{profile.className || "—"}
						</span>
					</div>
					<div className="flex justify-between items-center py-2 border-b border-slate-100">
						<span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
							Stream
						</span>
						<span className="text-sm font-medium text-slate-800">
							{profile.stream || "—"}
						</span>
					</div>
					<div className="flex justify-between items-center py-2 border-b border-slate-100">
						<span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
							Roll Number
						</span>
						<span className="text-sm font-medium text-slate-800">
							{profile.rollNumber || "—"}
						</span>
					</div>
					<div className="flex justify-between items-center py-2">
						<span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
							Joined
						</span>
						<span className="text-sm font-medium text-slate-800">
							{joinedDate}
						</span>
					</div>
				</div>
			</div>
			{/* Subjects */}
			{profile.subjects && profile.subjects.length > 0 && (
				<div className="bg-white rounded-2xl p-5 sm:p-6 mb-4">
					<h3 className="text-sm font-semibold mb-3 text-slate-900">
						Subjects
					</h3>
					<div className="space-y-3">
						{profile.subjects.map((s, i) => (
							<div key={i}>
								<div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">
									{s.label}
								</div>
								<div className="flex flex-wrap gap-1.5">
									{s.courses.map((c, j) => (
										<span
											key={j}
											className="px-2.5 py-1 bg-slate-100 rounded-lg text-xs font-medium text-slate-700"
										>
											{c}
										</span>
									))}
								</div>
							</div>
						))}
					</div>
				</div>
			)}
			{/* Streak, rank & insight */}
			{overview && (
				<div className="bg-white rounded-2xl p-5 sm:p-6 mb-4">
					<p className="text-xs text-slate-500 leading-relaxed mb-4">
						{overview.headline}
					</p>
					<div className="grid grid-cols-3 gap-2">
						<div className="bg-orange-50 rounded-xl p-3 text-center">
							<div className="text-xl font-black text-orange-500">
								{overview.streak.current}
							</div>
							<div className="text-[10px] font-semibold text-slate-400 uppercase mt-0.5">
								Streak
							</div>
						</div>
						<div className="bg-amber-50 rounded-xl p-3 text-center">
							<div className="text-xl font-black text-amber-600">
								{overview.rank != null ? `#${overview.rank}` : "—"}
							</div>
							<div className="text-[10px] font-semibold text-slate-400 uppercase mt-0.5">
								Rank
								{overview.totalStudents > 0
									? ` / ${overview.totalStudents}`
									: ""}
							</div>
						</div>
						<div className="bg-blue-50 rounded-xl p-3 text-center">
							<div className="text-xl font-black text-blue-600">
								{overview.pct}%
							</div>
							<div className="text-[10px] font-semibold text-slate-400 uppercase mt-0.5">
								{overview.month}
							</div>
						</div>
					</div>
					<div className="flex gap-2 mt-3 text-[11px] text-slate-400">
						<span className="flex-1 text-center">
							Best streak:{" "}
							<strong className="text-slate-600">{overview.streak.best}</strong>
						</span>
						<span className="flex-1 text-center">
							Perfect weeks:{" "}
							<strong className="text-slate-600">
								{overview.perfectWeeks}
							</strong>
						</span>
					</div>
					<button
						type="button"
						onClick={handleShare}
						className="w-full mt-3 py-2.5 rounded-xl border-none bg-slate-900 text-white text-xs font-semibold cursor-pointer min-h-[44px]"
					>
						Share My Progress
					</button>
					{shareMsg && (
						<p className="text-[11px] text-green-600 text-center mt-2 font-medium">
							{shareMsg}
						</p>
					)}
				</div>
			)}
			<YearAttendanceCard />
			{/* Badges */}{" "}
			{overview && overview.badges.some((b) => b.owned) && (
				<div className="bg-white rounded-2xl p-5 sm:p-6 mb-4">
					<h3 className="text-sm font-semibold mb-3 text-slate-900">
						Achievements
					</h3>
					<div className="grid grid-cols-3 gap-2">
						{overview.badges
							.filter((b) => b.owned)
							.map((b) => (
								<div
									key={b.id}
									className="bg-slate-50 rounded-xl p-2.5 text-center"
									title={b.desc}
								>
									<div className="text-2xl">{b.icon}</div>
									<div className="text-[10px] font-bold text-slate-700 mt-1 leading-tight">
										{b.name}
									</div>
								</div>
							))}
					</div>
				</div>
			)}
			{/* Discord Community Card */}
			<div className="bg-indigo-500 rounded-2xl p-5 mb-4 text-white shadow-md">
				<div className="flex items-center justify-between gap-3">
					<div className="flex items-center gap-3">
						<div className="w-10 h-10 rounded-xl bg-white/20 backdrop-blur-md flex items-center justify-center shrink-0">
							<svg
								className="w-6 h-6 fill-current text-white"
								viewBox="0 0 24 24"
							>
								<path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994.021-.041.001-.09-.041-.106a13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.061 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.028zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z" />
							</svg>
						</div>
						<div>
							<div className="font-bold text-sm">Join Discord Server</div>
							<div className="text-xs text-indigo-100">
								Connect with classmates & get live alerts
							</div>
						</div>
					</div>
					<a
						href="https://discord.gg/Ekrdugpejc"
						target="_blank"
						rel="noopener noreferrer"
						className="px-3.5 py-2 bg-white text-indigo-600 hover:bg-indigo-50 font-bold text-xs rounded-xl shadow-sm transition shrink-0 no-underline"
					>
						Join Chat →
					</a>
				</div>
			</div>
			<ChangePasswordCard />
		</div>
	);
};

interface YearMonth {
	month: string;
	total: number;
	present: number;
	absent: number;
	pct: number;
}

interface YearlyData {
	year: number;
	overall: {
		total: number;
		present: number;
		absent: number;
		pct: number;
		monthsCount: number;
	};
	months: YearMonth[];
	error?: string;
}

/** Whole-year overall attendance across every available month. */
const YearAttendanceCard: React.FC = () => {
	const [data, setData] = useState<YearlyData | null>(null);
	const [loading, setLoading] = useState(true);

	useEffect(() => {
		fetch("/api/engage/yearly")
			.then((res) => {
				if (!res.ok) throw new Error("Could not load year stats");
				return res.json();
			})
			.then((d: unknown) => {
				const parsed = d as YearlyData & { error?: string };
				if (parsed.error) throw new Error(parsed.error);
				setData(parsed);
			})
			.catch(() => setData(null))
			.finally(() => setLoading(false));
	}, []);

	if (loading) {
		return (
			<div className="bg-white rounded-2xl p-5 sm:p-6 mb-4">
				<div className="text-xs text-slate-400 animate-pulse">
					Loading year overview...
				</div>
			</div>
		);
	}

	if (!data || data.overall.total === 0) return null;

	const activeMonths = data.months.filter((m) => m.total > 0);
	const color =
		data.overall.pct >= 75
			? "#16a34a"
			: data.overall.pct >= 60
				? "#d97706"
				: "#dc2626";

	return (
		<div className="bg-white rounded-2xl p-5 sm:p-6 mb-4">
			<div className="flex items-end justify-between mb-1">
				<h3 className="text-sm font-semibold text-slate-900">
					{data.year} Overall
				</h3>
				<div className="text-2xl font-black" style={{ color }}>
					{data.overall.pct}%
				</div>
			</div>
			<p className="text-[11px] text-slate-400 mb-4">
				{data.overall.present} of {data.overall.total} classes across{" "}
				{data.overall.monthsCount} month
				{data.overall.monthsCount === 1 ? "" : "s"}
			</p>
			<div className="h-3 bg-slate-100 rounded-full overflow-hidden mb-4">
				<div
					className="h-full rounded-full"
					style={{ width: `${data.overall.pct}%`, background: color }}
				></div>
			</div>
			<div className="space-y-1.5">
				{activeMonths.map((m) => {
					const c =
						m.pct >= 75 ? "#16a34a" : m.pct >= 60 ? "#d97706" : "#dc2626";
					return (
						<div key={m.month} className="flex items-center gap-2.5">
							<span className="w-20 text-[11px] font-semibold text-slate-500 shrink-0">
								{m.month.slice(0, 3)}
							</span>
							<div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden">
								<div
									className="h-full rounded-full"
									style={{ width: `${m.pct}%`, background: c }}
								></div>
							</div>
							<span
								className="w-10 text-right text-[11px] font-bold shrink-0"
								style={{ color: c }}
							>
								{m.pct}%
							</span>
							<span className="w-14 text-right text-[10px] text-slate-400 shrink-0">
								{m.present}/{m.total}
							</span>
						</div>
					);
				})}
			</div>
		</div>
	);
};

const ChangePasswordCard: React.FC = () => {
	const [currentPassword, setCurrentPassword] = useState("");
	const [newPassword, setNewPassword] = useState("");
	const [confirm, setConfirm] = useState("");
	const [error, setError] = useState("");
	const [success, setSuccess] = useState("");
	const [loading, setLoading] = useState(false);

	const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
		e.preventDefault();
		setError("");
		setSuccess("");
		if (newPassword.length < 6) {
			setError("New password must be at least 6 characters.");
			return;
		}
		if (newPassword !== confirm) {
			setError("New passwords do not match.");
			return;
		}
		if (newPassword === currentPassword) {
			setError("New password must be different from the current one.");
			return;
		}
		setLoading(true);
		try {
			const res = await fetch("/api/auth/change-password", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ currentPassword, newPassword }),
			});
			const data = (await res.json()) as { message?: string; error?: string };
			if (!res.ok || data.error) {
				setError(data.error || "Could not change password.");
			} else {
				setSuccess(data.message || "Password changed.");
				setCurrentPassword("");
				setNewPassword("");
				setConfirm("");
			}
		} catch {
			setError("Network error. Please try again.");
		} finally {
			setLoading(false);
		}
	};

	return (
		<div className="bg-white rounded-2xl p-5 sm:p-6">
			<h3 className="text-sm font-semibold mb-1 text-slate-900">
				Change Password
			</h3>
			<p className="text-[11px] text-slate-400 mb-4">
				Other devices will be signed out automatically.
			</p>
			<form onSubmit={handleSubmit}>
				<label
					htmlFor="cp-current"
					className="block text-xs font-semibold text-slate-600 mb-1.5"
				>
					Current password
				</label>
				<input
					type="password"
					id="cp-current"
					value={currentPassword}
					onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
						setCurrentPassword(e.target.value)
					}
					required
					autoComplete="current-password"
					className="w-full px-3.5 py-2.5 rounded-xl border-none bg-slate-100 text-sm outline-none mb-3 min-h-[44px]"
				/>
				<label
					htmlFor="cp-new"
					className="block text-xs font-semibold text-slate-600 mb-1.5"
				>
					New password
				</label>
				<input
					type="password"
					id="cp-new"
					value={newPassword}
					onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
						setNewPassword(e.target.value)
					}
					placeholder="Min 6 characters"
					required
					minLength={6}
					autoComplete="new-password"
					className="w-full px-3.5 py-2.5 rounded-xl border-none bg-slate-100 text-sm outline-none mb-3 min-h-[44px]"
				/>
				<label
					htmlFor="cp-confirm"
					className="block text-xs font-semibold text-slate-600 mb-1.5"
				>
					Confirm new password
				</label>
				<input
					type="password"
					id="cp-confirm"
					value={confirm}
					onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
						setConfirm(e.target.value)
					}
					required
					minLength={6}
					autoComplete="new-password"
					className="w-full px-3.5 py-2.5 rounded-xl border-none bg-slate-100 text-sm outline-none mb-4 min-h-[44px]"
				/>
				<button
					type="submit"
					disabled={loading}
					className="w-full py-3 rounded-xl border-none bg-slate-900 text-white text-sm font-semibold cursor-pointer hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition min-h-[44px]"
				>
					{loading ? "Changing..." : "Change Password"}
				</button>
			</form>
			{error && (
				<div className="msg msg-error show mt-3.5 p-3 rounded-xl text-sm">
					{error}
				</div>
			)}
			{success && (
				<div className="msg msg-success show mt-3.5 p-3 rounded-xl text-sm">
					{success}
				</div>
			)}
		</div>
	);
};
