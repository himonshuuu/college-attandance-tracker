import React from "react";

export type TabType = "profile" | "subscribe" | "analytics" | "leaderboard";

interface NavbarProps {
  activeTab: TabType;
  setActiveTab: (tab: TabType) => void;
}

export const Navbar: React.FC<NavbarProps> = ({ activeTab, setActiveTab }) => {
  return (
    <nav className="nav-tabs">
      <button
        type="button"
        onClick={() => setActiveTab("profile")}
        className={`nav-tab border-none bg-transparent cursor-pointer ${activeTab === "profile" ? "active" : ""}`}
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          className="nav-icon"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
          <circle cx="12" cy="7" r="4" />
        </svg>
        <span>Profile</span>
      </button>

      <button
        type="button"
        onClick={() => setActiveTab("subscribe")}
        className={`nav-tab border-none bg-transparent cursor-pointer ${activeTab === "subscribe" ? "active" : ""}`}
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          className="nav-icon"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.73 21a2 2 0 0 1-3.46 0" />
        </svg>
        <span>Alerts</span>
      </button>

      <button
        type="button"
        onClick={() => setActiveTab("analytics")}
        className={`nav-tab border-none bg-transparent cursor-pointer ${activeTab === "analytics" ? "active" : ""}`}
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          className="nav-icon"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <rect x="3" y="3" width="7" height="7" />
          <rect x="14" y="3" width="7" height="7" />
          <rect x="14" y="14" width="7" height="7" />
          <rect x="3" y="14" width="7" height="7" />
        </svg>
        <span>Analytics</span>
      </button>

      <button
        type="button"
        onClick={() => setActiveTab("leaderboard")}
        className={`nav-tab border-none bg-transparent cursor-pointer ${activeTab === "leaderboard" ? "active" : ""}`}
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          className="nav-icon"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
        </svg>
        <span>Leaderboard</span>
      </button>
    </nav>
  );
};
