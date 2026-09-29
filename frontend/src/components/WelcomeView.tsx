import React, { useEffect, useState } from "react";

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
  headline: string;
  error?: string;
}

interface WelcomeViewProps {
  onContinue: () => void;
}

/** Onboarding win: the first thing a new user sees is live data + one insight. */
export const WelcomeView: React.FC<WelcomeViewProps> = ({ onContinue }) => {
  const [data, setData] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/engage/overview")
      .then((res) => {
        if (!res.ok) throw new Error("Could not load your attendance");
        return res.json();
      })
      .then((d: unknown) => {
        const parsed = d as Overview & { error?: string };
        if (parsed.error) throw new Error(parsed.error);
        setData(parsed);
      })
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div>
      <main className="bg-white rounded-2xl p-5 sm:p-6">
        {loading && <div className="text-center py-8 text-slate-400 text-sm animate-pulse">Fetching your attendance...</div>}

        {!loading && (error || !data) && (
          <div className="text-center py-6">
            <h2 className="text-base font-bold text-slate-900 mb-1">Account created!</h2>
            <p className="text-xs text-slate-400 mb-4">
              {error || "We couldn't fetch your attendance just now — your profile is ready though."}
            </p>
            <button
              type="button"
              onClick={onContinue}
              className="w-full py-3 rounded-xl border-none bg-blue-600 text-white text-sm font-semibold cursor-pointer min-h-[44px]"
            >
              View My Profile
            </button>
          </div>
        )}

        {!loading && data && (
          <>
            <div className="text-center mb-4">
              <h2 className="text-base font-bold text-slate-900">Account created!</h2>
              <p className="text-xs text-slate-500 mt-1 leading-relaxed">{data.headline}</p>
            </div>

            <div className="grid grid-cols-3 gap-2 mb-4">
              <div className="bg-slate-50 rounded-xl p-3 text-center">
                <div className="text-xl font-black text-blue-600">{data.pct}%</div>
                <div className="text-[10px] font-semibold text-slate-400 uppercase mt-0.5">{data.month}</div>
              </div>
              <div className="bg-slate-50 rounded-xl p-3 text-center">
                <div className="text-xl font-black text-orange-500">{data.streak.current}</div>
                <div className="text-[10px] font-semibold text-slate-400 uppercase mt-0.5">Streak</div>
              </div>
              <div className="bg-slate-50 rounded-xl p-3 text-center">
                <div className="text-xl font-black text-amber-600">
                  {data.rank != null ? `#${data.rank}` : "—"}
                </div>
                <div className="text-[10px] font-semibold text-slate-400 uppercase mt-0.5">Rank</div>
              </div>
            </div>

            <p className="text-[11px] text-slate-400 text-center mb-4">
              {data.present} of {data.total} classes attended{data.rank != null ? ` • #${data.rank} of ${data.totalStudents}` : ""} • Turn on alerts so you never miss a mark.
            </p>

            <button
              type="button"
              onClick={onContinue}
              className="w-full py-3 rounded-xl border-none bg-blue-600 text-white text-sm font-semibold cursor-pointer hover:opacity-90 transition min-h-[44px]"
            >
              Explore My Profile
            </button>
          </>
        )}
      </main>
    </div>
  );
};
