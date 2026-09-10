import React, { useEffect, useState } from "react";

interface ProfileData {
  user: { email: string; enrollmentId: string; joinedAt: string };
  profile: {
    name: string;
    className: string;
    stream: string;
    rollNumber: string;
    profilePhotoUrl: string;
  };
  subscriptions?: string[];
}

function initials(name: string): string {
  if (!name) return "S";
  return name.split(/\s+/).map(w => w[0]).slice(0, 2).join("").toUpperCase();
}

export const ProfileView: React.FC = () => {
  const [data, setData] = useState<ProfileData | null>(null);
  const [subs, setSubs] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    Promise.all([
      fetch("/api/profile").then((r) => r.json() as Promise<ProfileData & { error?: string }>),
      fetch("/api/subscribe").then((r) => r.json() as Promise<{ methods?: string[] }>),
    ])
      .then(([profileData, subData]) => {
        if (profileData.error) throw new Error(profileData.error);
        setData(profileData);
        if (subData && subData.methods) {
          setSubs(subData.methods);
        }
      })
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return <div className="text-center py-12 text-slate-400 text-sm">Loading profile...</div>;
  }

  if (error || !data) {
    return <div className="text-center py-12 text-red-500 text-sm">{error || "Could not load profile"}</div>;
  }

  const { profile, user } = data;
  const joinedDate = user.joinedAt ? new Date(user.joinedAt).toLocaleDateString() : "—";

  return (
    <div>
      <div className="bg-white rounded-2xl p-5 sm:p-6 mb-4">
        <div className="flex items-center gap-4 mb-5">
          <div className="w-16 h-16 rounded-full bg-blue-100 flex items-center justify-center shrink-0 overflow-hidden font-bold text-blue-600 text-xl">
            {profile.profilePhotoUrl ? (
              <img src={profile.profilePhotoUrl} alt={profile.name} className="w-full h-full object-cover" />
            ) : (
              initials(profile.name)
            )}
          </div>
          <div>
            <h2 className="text-lg font-bold text-slate-900">{profile.name || "—"}</h2>
            <p className="text-xs text-slate-400">{user.enrollmentId || "—"}</p>
          </div>
        </div>

        <div className="space-y-3">
          <div className="flex justify-between items-center py-2 border-b border-slate-100">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Email</span>
            <span className="text-sm font-medium text-slate-800">{user.email || "—"}</span>
          </div>
          <div className="flex justify-between items-center py-2 border-b border-slate-100">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Class</span>
            <span className="text-sm font-medium text-slate-800">{profile.className || "—"}</span>
          </div>
          <div className="flex justify-between items-center py-2 border-b border-slate-100">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Stream</span>
            <span className="text-sm font-medium text-slate-800">{profile.stream || "—"}</span>
          </div>
          <div className="flex justify-between items-center py-2 border-b border-slate-100">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Roll Number</span>
            <span className="text-sm font-medium text-slate-800">{profile.rollNumber || "—"}</span>
          </div>
          <div className="flex justify-between items-center py-2">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Joined</span>
            <span className="text-sm font-medium text-slate-800">{joinedDate}</span>
          </div>
        </div>
      </div>

      {/* Discord Community Card */}
      <div className="bg-gradient-to-r from-indigo-500 to-purple-600 rounded-2xl p-5 mb-4 text-white shadow-md">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-white/20 backdrop-blur-md flex items-center justify-center shrink-0">
              <svg className="w-6 h-6 fill-current text-white" viewBox="0 0 24 24">
                <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994.021-.041.001-.09-.041-.106a13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.061 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.028zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z"/>
              </svg>
            </div>
            <div>
              <div className="font-bold text-sm">Join Discord Server</div>
              <div className="text-xs text-indigo-100">Connect with classmates & get live alerts</div>
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

      <div className="bg-white rounded-2xl p-5 sm:p-6">
        <h3 className="text-sm font-semibold mb-3 text-slate-900">Subscriptions</h3>
        <div className="space-y-2">
          {subs.length === 0 ? (
            <div className="text-xs text-slate-400">No active notification subscriptions.</div>
          ) : (
            subs.map((m, idx) => (
              <div key={idx} className="flex items-center gap-2 text-xs font-medium text-slate-700 bg-slate-50 px-3 py-2 rounded-xl">
                <div className="w-2 h-2 rounded-full bg-blue-600"></div>
                {m === "firebase" || m === "browser" ? "Browser Push Notifications" : m === "email" ? "Email Alerts" : m === "monthly_report" ? "Monthly Report (End of Month)" : m}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};
