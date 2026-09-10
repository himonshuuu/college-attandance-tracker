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

      <div className="bg-white rounded-2xl p-5 sm:p-6">
        <h3 className="text-sm font-semibold mb-3 text-slate-900">Subscriptions</h3>
        <div className="space-y-2">
          {subs.length === 0 ? (
            <div className="text-xs text-slate-400">No active notification subscriptions.</div>
          ) : (
            subs.map((m, idx) => (
              <div key={idx} className="flex items-center gap-2 text-xs font-medium text-slate-700 bg-slate-50 px-3 py-2 rounded-xl">
                <div className="w-2 h-2 rounded-full bg-blue-600"></div>
                {m === "firebase" || m === "browser" ? "Browser Push Notifications" : m === "email" ? "Email Alerts" : m}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};
