import React from "react";
import { PATHS, navigate, type RouteName } from "../router";

export type TabType = "profile" | "subscribe" | "analytics" | "leaderboard" | "friends";

interface NavbarProps {
  activeTab: RouteName;
}

const TABS: Array<{ key: TabType; label: string; path: string; icon: React.ReactNode }> = [
  {
    key: "profile",
    label: "Profile",
    path: PATHS.profile,
    icon: (
      <>
        <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
        <circle cx="12" cy="7" r="4" />
      </>
    ),
  },
  {
    key: "subscribe",
    label: "Alerts",
    path: PATHS.subscribe,
    icon: (
      <>
        <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
        <path d="M13.73 21a2 2 0 0 1-3.46 0" />
      </>
    ),
  },
  {
    key: "analytics",
    label: "Stats",
    path: PATHS.analytics,
    icon: (
      <>
        <rect x="3" y="3" width="7" height="7" />
        <rect x="14" y="3" width="7" height="7" />
        <rect x="14" y="14" width="7" height="7" />
        <rect x="3" y="14" width="7" height="7" />
      </>
    ),
  },
  {
    key: "leaderboard",
    label: "Ranks",
    path: PATHS.leaderboard,
    icon: <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />,
  },
  {
    key: "friends",
    label: "Friends",
    path: PATHS.friends,
    icon: (
      <>
        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
        <circle cx="9" cy="7" r="4" />
        <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
        <path d="M16 3.13a4 4 0 0 1 0 7.75" />
      </>
    ),
  },
];

/** Mobile-first bottom nav: real links (shareable /paths), 44px touch targets. */
export const Navbar: React.FC<NavbarProps> = ({ activeTab }) => {
  return (
    <nav className="nav-tabs" aria-label="Main navigation">
      {TABS.map((tab) => (
        <a
          key={tab.key}
          href={tab.path}
          onClick={(e) => {
            e.preventDefault();
            navigate(tab.path);
          }}
          aria-current={activeTab === tab.key ? "page" : undefined}
          className={`nav-tab min-h-[44px] ${activeTab === tab.key ? "active" : ""}`}
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
            aria-hidden="true"
          >
            {tab.icon}
          </svg>
          <span>{tab.label}</span>
        </a>
      ))}
    </nav>
  );
};
