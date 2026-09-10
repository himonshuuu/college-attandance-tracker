import React, { useEffect, useState } from "react";

interface StudentLeaderboard {
  name: string;
  enrollmentId: string;
  total: number;
  present: number;
  absent: number;
  pct: number;
}

interface LeaderboardData {
  students: StudentLeaderboard[];
  month: string;
  year: number;
  totalStudents: number;
}

function initials(name: string): string {
  if (!name) return "S";
  return name.split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase();
}

export const LeaderboardView: React.FC = () => {
  const [data, setData] = useState<LeaderboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/leaderboard")
      .then((res) => {
        if (!res.ok) throw new Error("Failed to load leaderboard");
        return res.json();
      })
      .then((d: unknown) => {
        const parsed = d as LeaderboardData;
        if ((parsed as any).error) throw new Error((parsed as any).error);
        setData(parsed);
      })
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return <div className="text-center py-12 text-slate-400 text-sm">Loading leaderboard...</div>;
  }

  if (error || !data || !data.students || data.students.length === 0) {
    return <div className="text-center py-12 text-slate-400 text-sm">No students registered yet.</div>;
  }

  const { students } = data;

  const medals = [
    students[1] ? { cls: "silver", data: students[1], rank: "2nd" } : null,
    students[0] ? { cls: "gold", data: students[0], rank: "1st" } : null,
    students[2] ? { cls: "bronze", data: students[2], rank: "3rd" } : null,
  ].filter(Boolean) as Array<{ cls: string; data: StudentLeaderboard; rank: string }>;

  return (
    <div>
      {/* Top 3 Podium Cards */}
      {medals.length > 0 && (
        <div className="flex justify-center items-end gap-3 mb-6 flex-wrap">
          {medals.map((m, idx) => (
            <div
              key={idx}
              className={`podium-card ${m.cls} bg-white rounded-2xl p-4 text-center flex-1 max-w-[140px] sm:max-w-[160px] border border-slate-100 shadow-sm`}
            >
              <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">{m.rank}</div>
              <div className="pod-avatar w-11 h-11 rounded-full mx-auto mt-2.5 mb-2 flex items-center justify-center font-bold text-base text-white">
                {initials(m.data.name)}
              </div>
              <div className="text-sm font-semibold text-slate-900 mb-1 truncate">{m.data.name}</div>
              <div className="pod-pct text-2xl font-bold">{m.data.pct}%</div>
              <div className="text-[11px] text-slate-400 mt-0.5">
                {m.data.present}/{m.data.total} classes
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Full Students List */}
      <div className="bg-white rounded-2xl overflow-hidden border border-slate-100 shadow-sm">
        {students.map((st, i) => {
          const c = st.pct >= 75 ? "#16a34a" : st.pct >= 60 ? "#d97706" : "#dc2626";
          const rankClass = i === 0 ? "rank-1" : i === 1 ? "rank-2" : i === 2 ? "rank-3" : "";

          return (
            <div
              key={i}
              className={`flex items-center gap-3 px-4 py-3 ${rankClass} ${i % 2 === 1 ? "bg-slate-50" : ""}`}
            >
              <div className="rank-num w-7 text-sm font-bold text-slate-400 text-center shrink-0">{i + 1}</div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-semibold text-slate-900 truncate">{st.name}</div>
                <div className="text-[11px] text-slate-400">{st.enrollmentId}</div>
              </div>
              <div className="w-12 sm:w-24 h-1.5 bg-slate-100 rounded-full overflow-hidden shrink-0">
                <div className="h-full rounded-full" style={{ width: `${st.pct}%`, background: c }}></div>
              </div>
              <div className="w-10 text-right text-sm font-bold shrink-0" style={{ color: c }}>
                {st.pct}%
              </div>
              <div className="w-14 text-right text-[11px] text-slate-400 shrink-0 hidden sm:block">
                {st.present}/{st.total}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
