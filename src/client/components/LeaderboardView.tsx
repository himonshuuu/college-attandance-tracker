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
  const first = students[0];
  const second = students[1];
  const third = students[2];

  return (
    <div>
      {/* Top 3 Podium Cards */}
      {students.length > 0 && (
        <div className="flex items-end justify-center gap-2 sm:gap-4 mb-8 pt-4">
          {/* 2nd Place (Silver) - Left */}
          {second ? (
            <div className="podium-card silver bg-white rounded-2xl p-3 sm:p-4 text-center flex-1 max-w-[110px] sm:max-w-[140px] min-h-[170px] sm:min-h-[195px] flex flex-col justify-between border border-slate-200 shadow-sm relative">
              <div>
                <span className="inline-block px-2 py-0.5 rounded-full text-[10px] sm:text-xs font-extrabold bg-slate-100 text-slate-600 mb-2">
                  2nd
                </span>
                <div className="pod-avatar w-11 h-11 sm:w-12 sm:h-12 rounded-full mx-auto mb-2 flex items-center justify-center font-bold text-sm sm:text-base text-white shadow-sm">
                  {initials(second.name)}
                </div>
                <div className="text-xs sm:text-sm font-bold text-slate-800 truncate px-1" title={second.name}>
                  {second.name}
                </div>
              </div>
              <div>
                <div className="pod-pct text-xl sm:text-2xl font-black">{second.pct}%</div>
                <div className="text-[10px] sm:text-[11px] text-slate-400 mt-0.5">
                  {second.present}/{second.total}
                </div>
              </div>
            </div>
          ) : (
            <div className="flex-1 max-w-[110px] sm:max-w-[140px]"></div>
          )}

          {/* 1st Place (Gold) - Center (Taller) */}
          {first && (
            <div className="podium-card gold bg-gradient-to-b from-amber-50/60 to-white rounded-2xl p-3.5 sm:p-5 text-center flex-1 max-w-[130px] sm:max-w-[165px] min-h-[210px] sm:min-h-[245px] flex flex-col justify-between border-2 border-amber-400 shadow-lg shadow-amber-500/10 relative -translate-y-3 z-10">
              {/* Crown Badge */}
              <div className="absolute -top-3.5 left-1/2 -translate-x-1/2 bg-amber-400 text-amber-950 px-2.5 py-0.5 rounded-full text-[11px] font-black shadow-sm flex items-center gap-1">
                <span>👑</span> 1st
              </div>
              <div className="pt-2">
                <div className="pod-avatar w-12 h-12 sm:w-16 sm:h-16 rounded-full mx-auto mb-2 flex items-center justify-center font-black text-base sm:text-xl text-white shadow-md ring-4 ring-amber-400/30">
                  {initials(first.name)}
                </div>
                <div className="text-xs sm:text-sm font-black text-slate-900 truncate px-1" title={first.name}>
                  {first.name}
                </div>
              </div>
              <div>
                <div className="pod-pct text-2xl sm:text-3xl font-black">{first.pct}%</div>
                <div className="text-[10px] sm:text-[11px] font-semibold text-amber-700 mt-0.5">
                  {first.present}/{first.total} classes
                </div>
              </div>
            </div>
          )}

          {/* 3rd Place (Bronze) - Right */}
          {third ? (
            <div className="podium-card bronze bg-white rounded-2xl p-3 sm:p-4 text-center flex-1 max-w-[110px] sm:max-w-[140px] min-h-[155px] sm:min-h-[180px] flex flex-col justify-between border border-amber-200/80 shadow-sm relative">
              <div>
                <span className="inline-block px-2 py-0.5 rounded-full text-[10px] sm:text-xs font-extrabold bg-amber-50 text-amber-800 mb-2">
                  3rd
                </span>
                <div className="pod-avatar w-10 h-10 sm:w-11 sm:h-11 rounded-full mx-auto mb-2 flex items-center justify-center font-bold text-xs sm:text-sm text-white shadow-sm">
                  {initials(third.name)}
                </div>
                <div className="text-xs sm:text-sm font-bold text-slate-800 truncate px-1" title={third.name}>
                  {third.name}
                </div>
              </div>
              <div>
                <div className="pod-pct text-xl sm:text-2xl font-black">{third.pct}%</div>
                <div className="text-[10px] sm:text-[11px] text-slate-400 mt-0.5">
                  {third.present}/{third.total}
                </div>
              </div>
            </div>
          ) : (
            <div className="flex-1 max-w-[110px] sm:max-w-[140px]"></div>
          )}
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
