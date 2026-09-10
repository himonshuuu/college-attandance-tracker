import React, { useEffect, useRef, useState } from "react";

interface SubjectStat {
  name: string;
  present: number;
  absent: number;
  total: number;
  pct: number;
}

interface DailyStat {
  date: string;
  present: number;
  absent: number;
  pct: number;
}

interface AttendanceRecord {
  date: string;
  subject: string;
  teacher: string;
  classTiming: string;
  subjectType?: string;
  status: string;
}

interface AnalyticsData {
  student: { name: string; enrollmentId: string; className: string; stream: string };
  month: string;
  year: number;
  total: number;
  present: number;
  absent: number;
  pct: number;
  subjects: SubjectStat[];
  daily: DailyStat[];
  records: AttendanceRecord[];
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
) {
  if (w < 0 || h < 0) return;
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

export const AnalyticsView: React.FC = () => {
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const trendCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const subCanvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    fetch("/api/analytics")
      .then((res) => {
        if (!res.ok) throw new Error("Failed to load analytics");
        return res.json();
      })
      .then((d: unknown) => {
        const parsed = d as AnalyticsData;
        if ((parsed as any).error) throw new Error((parsed as any).error);
        setData(parsed);
      })
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  // Draw trend canvas
  useEffect(() => {
    if (!data || !trendCanvasRef.current) return;
    const canvas = trendCanvasRef.current;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const parent = canvas.parentElement;
    const W = parent ? parent.clientWidth - 40 : 320;
    const H = 200;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    canvas.style.width = W + "px";
    canvas.style.height = H + "px";
    ctx.scale(dpr, dpr);

    const daily = data.daily || [];
    if (daily.length === 0) {
      ctx.fillStyle = "#94a3b8";
      ctx.font = "13px system-ui";
      ctx.textAlign = "center";
      ctx.fillText("No data yet", W / 2, H / 2);
      return;
    }

    const pad = { l: 32, r: 12, t: 12, b: 28 };
    const cw = W - pad.l - pad.r;
    const ch = H - pad.t - pad.b;
    const barW = Math.min(20, Math.max(4, cw / daily.length - 2));
    const gap = cw / daily.length;

    ctx.strokeStyle = "#f1f5f9";
    ctx.lineWidth = 1;
    for (let i = 0; i <= 4; i++) {
      const y = pad.t + ch * (1 - i / 4);
      ctx.beginPath();
      ctx.moveTo(pad.l, y);
      ctx.lineTo(W - pad.r, y);
      ctx.stroke();
      ctx.fillStyle = "#94a3b8";
      ctx.font = "10px system-ui";
      ctx.textAlign = "right";
      ctx.textBaseline = "middle";
      ctx.fillText(i * 25 + "%", pad.l - 6, y);
    }

    for (let i = 0; i < daily.length; i++) {
      const x = pad.l + gap * i + gap / 2;
      const day = daily[i];
      const ph = (day.pct / 100) * ch;

      ctx.fillStyle = "#16a34a";
      ctx.beginPath();
      roundRect(ctx, x - barW / 2, pad.t + ch - ph, barW / 2 - 1, ph, 3);
      ctx.fill();

      const totalDay = day.present + day.absent;
      const ah = ((100 - day.pct) / 100) * ch * (totalDay > 0 ? day.absent / totalDay : 0);
      ctx.fillStyle = "#dc2626";
      ctx.beginPath();
      roundRect(ctx, x + 1, pad.t + ch - ph - ah, barW / 2 - 1, ah, 3);
      ctx.fill();

      if (i % Math.max(1, Math.floor(daily.length / 8)) === 0 || i === daily.length - 1) {
        ctx.fillStyle = "#94a3b8";
        ctx.font = "9px system-ui";
        ctx.textAlign = "center";
        ctx.textBaseline = "top";
        ctx.fillText(day.date.slice(5), x, pad.t + ch + 6);
      }
    }
  }, [data]);

  // Draw subject canvas
  useEffect(() => {
    if (!data || !subCanvasRef.current) return;
    const canvas = subCanvasRef.current;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const parent = canvas.parentElement;
    const W = parent ? parent.clientWidth - 40 : 320;
    const H = 180;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    canvas.style.width = W + "px";
    canvas.style.height = H + "px";
    ctx.scale(dpr, dpr);

    const subjects = data.subjects || [];
    if (subjects.length === 0) {
      ctx.fillStyle = "#94a3b8";
      ctx.font = "13px system-ui";
      ctx.textAlign = "center";
      ctx.fillText("No data yet", W / 2, H / 2);
      return;
    }

    const pad = { t: 8, b: 20 };
    const barH = 22;
    const gap = 6;
    const maxBars = Math.min(subjects.length, Math.floor((H - pad.t - pad.b) / (barH + gap)));
    const list = subjects.slice(0, maxBars);
    const maxPct = Math.max(100, ...list.map((s) => s.pct));

    for (let i = 0; i < list.length; i++) {
      const y = pad.t + i * (barH + gap);
      const s = list[i];
      const barW = (s.pct / maxPct) * (W - 100);
      const c = s.pct >= 75 ? "#16a34a" : s.pct >= 60 ? "#d97706" : "#dc2626";

      ctx.fillStyle = "#f1f5f9";
      ctx.beginPath();
      roundRect(ctx, 110, y, W - 130, barH, 6);
      ctx.fill();

      ctx.fillStyle = c;
      ctx.beginPath();
      roundRect(ctx, 110, y, Math.max(barW, 4), barH, 6);
      ctx.fill();

      ctx.fillStyle = "#334155";
      ctx.font = "12px system-ui";
      ctx.textAlign = "right";
      ctx.textBaseline = "middle";
      ctx.fillText(s.name.length > 14 ? s.name.slice(0, 13) + "…" : s.name, 104, y + barH / 2);

      ctx.fillStyle = c;
      ctx.font = "bold 11px system-ui";
      ctx.textAlign = "left";
      ctx.fillText(s.pct + "%", 110 + barW + 6, y + barH / 2);
    }
  }, [data]);

  if (loading) {
    return <div className="text-center py-12 text-slate-400 text-sm">Loading analytics...</div>;
  }

  if (error || !data) {
    return <div className="text-center py-12 text-red-500 text-sm">{error || "Could not load analytics"}</div>;
  }

  const { pct, present, absent, total, subjects, records } = data;
  const pctColor = pct >= 75 ? "#16a34a" : pct >= 60 ? "#d97706" : "#dc2626";

  const needed = pct < 75 ? Math.ceil((75 * (present + absent) - 100 * present) / 25) : 0;
  const healthMsg =
    pct >= 75
      ? "Healthy attendance. Keep it up!"
      : pct >= 60
      ? `Needs attention. ${needed > 0 ? "Need " + needed + " more presents to reach 75%." : "Keep attending."}`
      : `Critical. ${needed > 0 ? "Need " + needed + " more presents to reach 75%." : "Attend all classes to recover."}`;

  const sortedRecords = [...(records || [])].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 40);

  return (
    <div>
      {/* 4 Summary Stat Cards */}
      <div className="grid grid-cols-2 gap-3 mb-4">
        <div className="bg-white rounded-2xl p-4">
          <div className="text-2xl font-bold leading-none text-blue-600">{total}</div>
          <div className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest mt-1.5">Total</div>
        </div>
        <div className="bg-white rounded-2xl p-4">
          <div className="text-2xl font-bold leading-none text-green-600">{present}</div>
          <div className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest mt-1.5">Present</div>
        </div>
        <div className="bg-white rounded-2xl p-4">
          <div className="text-2xl font-bold leading-none text-red-500">{absent}</div>
          <div className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest mt-1.5">Absent</div>
        </div>
        <div className="bg-white rounded-2xl p-4">
          <div className="text-2xl font-bold leading-none" style={{ color: pctColor }}>
            {pct}%
          </div>
          <div className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest mt-1.5">Attendance %</div>
        </div>
      </div>

      {/* Overall Attendance */}
      <div className="bg-white rounded-2xl p-5 mb-4">
        <h2 className="text-sm font-semibold mb-3 text-slate-900">Overall Attendance</h2>
        <div className="space-y-3">
          <div>
            <div className="flex justify-between text-xs mb-1">
              <span className="text-slate-500">Present</span>
              <span className="font-semibold text-green-600">{present}</span>
            </div>
            <div className="h-3 bg-slate-100 rounded-full overflow-hidden">
              <div
                className="h-full bg-green-500 rounded-full transition-all duration-500"
                style={{ width: `${total > 0 ? (present / total) * 100 : 0}%` }}
              ></div>
            </div>
          </div>
          <div>
            <div className="flex justify-between text-xs mb-1">
              <span className="text-slate-500">Absent</span>
              <span className="font-semibold text-red-500">{absent}</span>
            </div>
            <div className="h-3 bg-slate-100 rounded-full overflow-hidden">
              <div
                className="h-full bg-red-400 rounded-full transition-all duration-500"
                style={{ width: `${total > 0 ? (absent / total) * 100 : 0}%` }}
              ></div>
            </div>
          </div>
          <div className="pt-2 border-t border-slate-100">
            <div className="flex justify-between text-xs mb-1">
              <span className="text-slate-500">Attendance</span>
              <span className="font-bold" style={{ color: pctColor }}>
                {pct}%
              </span>
            </div>
            <div className="h-4 bg-slate-100 rounded-full overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-500"
                style={{ width: `${pct}%`, background: pctColor }}
              ></div>
            </div>
          </div>
        </div>
        <div className="text-xs text-slate-400 mt-3 text-center">
          {present} of {total} classes attended
        </div>
      </div>

      {/* Daily Attendance Trend */}
      <div className="bg-white rounded-2xl p-5 mb-4">
        <h2 className="text-sm font-semibold mb-3 text-slate-900">Daily Attendance Trend</h2>
        <canvas ref={trendCanvasRef} height="200"></canvas>
        <div className="flex flex-wrap gap-3 mt-3">
          <div className="flex items-center gap-1.5 text-xs text-slate-400">
            <div className="w-2 h-2 rounded-full bg-green-600"></div>Present
          </div>
          <div className="flex items-center gap-1.5 text-xs text-slate-400">
            <div className="w-2 h-2 rounded-full bg-red-500"></div>Absent
          </div>
        </div>
      </div>

      {/* Subject-wise Breakdown Chart */}
      <div className="bg-white rounded-2xl p-5 mb-4">
        <h2 className="text-sm font-semibold mb-3 text-slate-900">Subject-wise Breakdown</h2>
        <canvas ref={subCanvasRef} height="180"></canvas>
      </div>

      {/* Attendance Health */}
      <div className="bg-white rounded-2xl p-5 mb-4">
        <h2 className="text-sm font-semibold mb-3 text-slate-900">Attendance Health</h2>
        <div className="flex items-center gap-3 mb-1.5">
          <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-500"
              style={{ width: `${pct}%`, background: pctColor }}
            ></div>
          </div>
          <span className="text-sm font-bold" style={{ color: pctColor }}>
            {pct}%
          </span>
        </div>
        <p className="text-sm text-slate-400">{healthMsg}</p>
      </div>

      {/* Subject Progress List */}
      <div className="bg-white rounded-2xl p-5 mb-4">
        <h2 className="text-sm font-semibold mb-3 text-slate-900">Subject Progress</h2>
        <div>
          {subjects.length === 0 ? (
            <div className="text-center py-8 text-slate-400 text-sm">No data yet</div>
          ) : (
            subjects.map((s, idx) => {
              const c = s.pct >= 75 ? "#16a34a" : s.pct >= 60 ? "#d97706" : "#dc2626";
              return (
                <div key={idx} className="flex items-center gap-2.5 py-1.5">
                  <div className="w-20 sm:w-28 text-xs font-medium truncate shrink-0">{s.name}</div>
                  <div className="flex-1 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all duration-500"
                      style={{ width: `${s.pct}%`, background: c }}
                    ></div>
                  </div>
                  <div className="w-8 text-right text-[11px] font-semibold shrink-0" style={{ color: c }}>
                    {s.pct}%
                  </div>
                  <div className="text-[11px] text-slate-400 w-12 text-right shrink-0 hidden sm:block">
                    {s.present}/{s.total}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* Recent Records Table */}
      <div className="bg-white rounded-2xl p-5">
        <h2 className="text-sm font-semibold mb-3 text-slate-900">Recent Records</h2>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-xs">
            <thead>
              <tr className="text-left border-b border-slate-100">
                <th className="px-2.5 py-2 text-[10px] font-semibold text-slate-400 uppercase tracking-wider">Date</th>
                <th className="px-2.5 py-2 text-[10px] font-semibold text-slate-400 uppercase tracking-wider">Subject</th>
                <th className="px-2.5 py-2 text-[10px] font-semibold text-slate-400 uppercase tracking-wider td-responsive">Teacher</th>
                <th className="px-2.5 py-2 text-[10px] font-semibold text-slate-400 uppercase tracking-wider td-responsive">Time</th>
                <th className="px-2.5 py-2 text-[10px] font-semibold text-slate-400 uppercase tracking-wider td-responsive">Type</th>
                <th className="px-2.5 py-2 text-[10px] font-semibold text-slate-400 uppercase tracking-wider">Status</th>
              </tr>
            </thead>
            <tbody>
              {sortedRecords.length === 0 ? (
                <tr>
                  <td colSpan={6} className="text-center py-8 text-slate-400">
                    No records
                  </td>
                </tr>
              ) : (
                sortedRecords.map((r, idx) => {
                  const cls =
                    r.status === "Present"
                      ? "bg-green-50 text-green-600"
                      : r.status === "Absent"
                      ? "bg-red-50 text-red-500"
                      : "bg-slate-100 text-slate-400";
                  return (
                    <tr key={idx} className="even:bg-slate-50 border-b border-slate-50">
                      <td className="px-2.5 py-2 whitespace-nowrap">{r.date}</td>
                      <td className="px-2.5 py-2 font-medium">{r.subject}</td>
                      <td className="px-2.5 py-2 td-responsive text-slate-500">{r.teacher}</td>
                      <td className="px-2.5 py-2 td-responsive text-slate-500">{r.classTiming}</td>
                      <td className="px-2.5 py-2 td-responsive text-slate-500">{r.subjectType || "—"}</td>
                      <td className="px-2.5 py-2">
                        <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-semibold ${cls}`}>
                          {r.status || "?"}
                        </span>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
