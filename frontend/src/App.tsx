import React, { useEffect, useState } from "react";
import { Navbar } from "./components/Navbar";
import { LoginView } from "./components/LoginView";
import { RegisterView } from "./components/RegisterView";
import { ForgotPasswordView } from "./components/ForgotPasswordView";
import { ResetPasswordView } from "./components/ResetPasswordView";
import { WelcomeView } from "./components/WelcomeView";
import { ProfileView } from "./components/ProfileView";
import { AnalyticsView } from "./components/AnalyticsView";
import { LeaderboardView } from "./components/LeaderboardView";
import { SubscribeView } from "./components/SubscribeView";
import { FriendsView } from "./components/FriendsView";
import {
	PATHS,
	navigate,
	navigateReplace,
	useRoute,
	type RouteName,
} from "./router";

const AUTH_ROUTES: RouteName[] = ["login", "register", "forgot", "reset"];
const APP_ROUTES: RouteName[] = [
	"profile",
	"analytics",
	"leaderboard",
	"subscribe",
	"friends",
];

function resetTokenFromQuery(query: URLSearchParams): string | null {
	return (
		query.get("resetToken") || query.get("reset-token") || query.get("token")
	);
}

function clearResetTokenFromUrl(): void {
	try {
		const url = new URL(window.location.href);
		url.searchParams.delete("resetToken");
		url.searchParams.delete("reset-token");
		url.searchParams.delete("token");
		window.history.replaceState({}, "", url.toString());
		window.dispatchEvent(new PopStateEvent("popstate"));
	} catch {
		// Ignore
	}
}

function titleFor(
	route: RouteName,
	userEmail: string,
): { title: string; subtitle: string } {
	switch (route) {
		case "login":
			return {
				title: "Attendance Monitor",
				subtitle: "Sign in to your account",
			};
		case "register":
			return { title: "Attendance Monitor", subtitle: "Create your account" };
		case "forgot":
			return { title: "Attendance Monitor", subtitle: "Recover your account" };
		case "reset":
			return { title: "Attendance Monitor", subtitle: "Choose a new password" };
		case "analytics":
			return {
				title: "Attendance Analytics",
				subtitle: new Date().toLocaleDateString("en-US", {
					weekday: "long",
					month: "long",
					day: "numeric",
					year: "numeric",
				}),
			};
		case "leaderboard":
			return {
				title: "Attendance Leaderboard",
				subtitle: new Date().toLocaleDateString("en-US", {
					month: "long",
					year: "numeric",
				}),
			};
		case "subscribe":
			return { title: "Attendance Alerts", subtitle: userEmail };
		case "friends":
			return { title: "Friends", subtitle: "Compare with classmates" };
		case "profile":
		case "home":
		default:
			return {
				title: "My Profile",
				subtitle: userEmail || "Attendance Monitor",
			};
	}
}

export const App: React.FC = () => {
	const { route, query } = useRoute();
	const [authChecked, setAuthChecked] = useState(false);
	const [isAuthenticated, setIsAuthenticated] = useState(false);
	const [userEmail, setUserEmail] = useState("");
	const [showWelcome, setShowWelcome] = useState(false);

	const checkAuth = async () => {
		try {
			const res = await fetch("/api/auth/me");
			const data = (await res.json()) as {
				authenticated?: boolean;
				email?: string;
			};
			if (data && data.authenticated) {
				setIsAuthenticated(true);
				setUserEmail(data.email || "");
			} else {
				setIsAuthenticated(false);
				setUserEmail("");
			}
		} catch {
			setIsAuthenticated(false);
			setUserEmail("");
		} finally {
			setAuthChecked(true);
		}
	};

	useEffect(() => {
		checkAuth();
		try {
			if (window.sessionStorage.getItem("welcome") === "1") {
				window.sessionStorage.removeItem("welcome");
				setShowWelcome(true);
			}
		} catch {
			// Ignore
		}
	}, []);

	// Route guards: keep authed users out of auth pages and guests out of app pages.
	useEffect(() => {
		if (!authChecked) return;
		const token = resetTokenFromQuery(query);
		if (isAuthenticated) {
			if (AUTH_ROUTES.includes(route) && !(route === "reset" && token)) {
				navigateReplace(PATHS.profile);
			}
		} else {
			if (route === "home" || APP_ROUTES.includes(route)) {
				navigateReplace(PATHS.login);
			}
		}
	}, [authChecked, isAuthenticated, route, query]);

	const handleLogout = async () => {
		try {
			await fetch("/api/auth/logout", { method: "POST" });
		} catch {
			// Ignore fallback
		}
		setIsAuthenticated(false);
		setUserEmail("");
		setShowWelcome(false);
		navigate(PATHS.login);
	};

	if (!authChecked) {
		return (
			<div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
				<div className="text-slate-400 text-sm font-medium animate-pulse">
					Loading Attendance Monitor...
				</div>
			</div>
		);
	}

	const onReset = resetTokenFromQuery(query);
	const effectiveRoute: RouteName =
		route === "home" ? (isAuthenticated ? "profile" : "login") : route;

	// A reset link always wins — even for signed-in users.
	const showReset =
		onReset != null &&
		onReset !== "" &&
		(route === "reset" || route === "home");

	const { title, subtitle } = showReset
		? { title: "Attendance Monitor", subtitle: "Choose a new password" }
		: showWelcome && isAuthenticated
			? { title: "Welcome!", subtitle: "Here's your attendance at a glance" }
			: titleFor(effectiveRoute, userEmail);

	const backToLogin = () => {
		clearResetTokenFromUrl();
		navigate(PATHS.login);
	};

	const renderMain = () => {
		if (showReset) {
			return (
				<ResetPasswordView
					token={onReset as string}
					onBackToLogin={backToLogin}
				/>
			);
		}
		if (showWelcome && isAuthenticated) {
			return <WelcomeView onContinue={() => setShowWelcome(false)} />;
		}
		switch (effectiveRoute) {
			case "login":
				return (
					<LoginView
						onLoginSuccess={async () => {
							await checkAuth();
							navigate(PATHS.profile);
						}}
						onSwitchToRegister={() => navigate(PATHS.register)}
						onForgotPassword={() => navigate(PATHS.forgot)}
					/>
				);
			case "register":
				return (
					<RegisterView
						onRegisterSuccess={async () => {
							try {
								window.sessionStorage.setItem("welcome", "1");
							} catch {
								// Ignore
							}
							await checkAuth();
							navigate(PATHS.profile);
						}}
						onSwitchToLogin={() => navigate(PATHS.login)}
					/>
				);
			case "forgot":
				return (
					<ForgotPasswordView onBackToLogin={() => navigate(PATHS.login)} />
				);
			case "reset":
				return (
					<div className="bg-white rounded-2xl p-5 sm:p-6 text-center">
						<p className="text-sm text-slate-500">
							This reset link is missing its token.
						</p>
						<button
							type="button"
							onClick={() => navigate(PATHS.forgot)}
							className="mt-4 px-4 py-2.5 rounded-xl border-none bg-blue-600 text-white text-sm font-semibold cursor-pointer min-h-[44px]"
						>
							Request a new link
						</button>
					</div>
				);
			case "analytics":
				return <AnalyticsView />;
			case "leaderboard":
				return <LeaderboardView />;
			case "subscribe":
				return <SubscribeView />;
			case "friends":
				return <FriendsView />;
			case "profile":
			default:
				return <ProfileView />;
		}
	};

	const showChrome =
		isAuthenticated &&
		!showReset &&
		!showWelcome &&
		APP_ROUTES.includes(effectiveRoute);

	return (
		<div className="bg-slate-50 text-slate-900 min-h-screen">
			<div className="w-full max-w-[430px] mx-auto min-h-screen flex flex-col px-2 pt-4">
				{/* Header */}
				<header className="sticky top-0 z-40 flex items-center gap-3 pb-3 mb-3 -mx-2 px-2 pt-[env(safe-area-inset-top)] bg-slate-50/88 backdrop-blur-md">
					<div className="w-9 h-9 bg-blue-600 text-white rounded-[10px] flex items-center justify-center font-bold text-sm shrink-0 shadow-sm">
						A
					</div>
					<div className="flex-1 min-w-0">
						<h1 className="text-lg font-bold text-slate-900 truncate">
							{title}
						</h1>
						<div className="text-slate-400 text-xs truncate">{subtitle}</div>
					</div>
					{isAuthenticated && !showReset && (
						<button
							type="button"
							onClick={handleLogout}
							className="px-3 py-1.5 rounded-lg text-xs font-medium bg-slate-100 text-slate-400 hover:bg-slate-200 transition border-none cursor-pointer min-h-[44px]"
						>
							Logout
						</button>
					)}
				</header>

				{/* Main Content Area */}
				<main className="flex-1 pb-[calc(96px+env(safe-area-inset-bottom))]">
					{renderMain()}
				</main>

				{/* Fixed Bottom Navbar */}
				{showChrome && (
					<div className="fixed bottom-0 left-0 right-0 z-50 bg-slate-50/90 backdrop-blur-md">
						<div className="w-full max-w-[430px] mx-auto px-3 pt-2 pb-[env(safe-area-inset-bottom)]">
							<Navbar activeTab={effectiveRoute} />
						</div>
					</div>
				)}
			</div>
		</div>
	);
};
