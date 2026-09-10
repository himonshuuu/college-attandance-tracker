import React, { useEffect, useState } from "react";
import { Navbar, type TabType } from "./components/Navbar";
import { LoginView } from "./components/LoginView";
import { RegisterView } from "./components/RegisterView";
import { ProfileView } from "./components/ProfileView";
import { AnalyticsView } from "./components/AnalyticsView";
import { LeaderboardView } from "./components/LeaderboardView";
import { SubscribeView } from "./components/SubscribeView";

export const App: React.FC = () => {
  const [authChecked, setAuthChecked] = useState(false);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [userEmail, setUserEmail] = useState("");
  const [authMode, setAuthMode] = useState<"login" | "register">("login");
  const [activeTab, setActiveTab] = useState<TabType>("profile");

  const checkAuth = async () => {
    try {
      const res = await fetch("/api/auth/me");
      const data = (await res.json()) as { authenticated?: boolean; email?: string };
      if (data && data.authenticated) {
        setIsAuthenticated(true);
        setUserEmail(data.email || "");
      } else {
        setIsAuthenticated(false);
      }
    } catch {
      setIsAuthenticated(false);
    } finally {
      setAuthChecked(true);
    }
  };

  useEffect(() => {
    checkAuth();
  }, []);

  const handleLogout = async () => {
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } catch {
      // Ignore fallback
    }
    setIsAuthenticated(false);
    setUserEmail("");
  };

  if (!authChecked) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <div className="text-slate-400 text-sm font-medium animate-pulse">Loading Attendance Monitor...</div>
      </div>
    );
  }

  let title = "Attendance Monitor";
  let subtitle = authMode === "login" ? "Sign in to your account" : "Create your account";

  if (isAuthenticated) {
    if (activeTab === "profile") {
      title = "My Profile";
      subtitle = userEmail;
    } else if (activeTab === "subscribe") {
      title = "Attendance Alerts";
      subtitle = userEmail;
    } else if (activeTab === "analytics") {
      title = "Attendance Analytics";
      subtitle = new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" });
    } else if (activeTab === "leaderboard") {
      title = "Attendance Leaderboard";
      subtitle = new Date().toLocaleDateString("en-US", { month: "long", year: "numeric" });
    }
  }

  return (
    <div className="bg-slate-50 text-slate-900 min-h-screen p-4 sm:p-6 pb-24">
      <div className="max-w-lg mx-auto">
        {/* Header */}
        <header className="flex items-center gap-3 mb-6">
          <div className="w-9 h-9 bg-blue-600 text-white rounded-[10px] flex items-center justify-center font-bold text-sm shrink-0 shadow-sm">
            A
          </div>
          <div className="flex-1 min-w-0">
            <h1 className="text-lg font-bold text-slate-900 truncate">{title}</h1>
            <div className="text-slate-400 text-xs truncate">{subtitle}</div>
          </div>
          {isAuthenticated && (
            <button
              type="button"
              onClick={handleLogout}
              className="px-3 py-1.5 rounded-lg text-xs font-medium bg-slate-100 text-slate-400 hover:bg-slate-200 transition border-none cursor-pointer"
            >
              Logout
            </button>
          )}
        </header>

        {/* Main Content Area */}
        <main className="mb-12">
          {!isAuthenticated ? (
            authMode === "login" ? (
              <LoginView
                onLoginSuccess={() => {
                  checkAuth();
                  setActiveTab("profile");
                }}
                onSwitchToRegister={() => setAuthMode("register")}
              />
            ) : (
              <RegisterView
                onRegisterSuccess={() => {
                  checkAuth();
                  setActiveTab("profile");
                }}
                onSwitchToLogin={() => setAuthMode("login")}
              />
            )
          ) : (
            <>
              {activeTab === "profile" && <ProfileView />}
              {activeTab === "analytics" && <AnalyticsView />}
              {activeTab === "leaderboard" && <LeaderboardView />}
              {activeTab === "subscribe" && <SubscribeView />}
            </>
          )}
        </main>

        {/* Fixed Bottom Navbar */}
        {isAuthenticated && (
          <div className="fixed bottom-0 left-0 right-0 z-50 p-3 bg-slate-50/90 backdrop-blur-md">
            <div className="max-w-lg mx-auto">
              <Navbar activeTab={activeTab} setActiveTab={setActiveTab} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
