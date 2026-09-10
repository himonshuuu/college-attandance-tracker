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

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"
];

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
  ctx.quadraticCurveTo(x + w, y, x + w, y + h - r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

export const AnalyticsView: React.FC = () => {
  const currentDate = new Date();
  const [selectedMonth, setSelectedMonth] = useState<number>(currentDate.getMonth() + 1);
  const [selectedYear, setSelectedYear] = useState<number>(currentDate.getFullYear());
  const [targetPct, setTargetPct] = useState<number>(75);

  const [data, setData] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [activeSubjectModal, setActiveSubjectModal] = useState<string | null>(null);
  const [modalFilter, setModalFilter] = useState<"All" | "Present" | "Absent">("All");

  const trendCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const subCanvasRef = useRef<HTMLCanvasElement | null>(null);

  const fetchAnalytics = (m: number, y: number) => {
    setLoading(true);
    setError("");
    fetch(`/api/analytics?month=${m}&year=${y}`)
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
  };

  useEffect(() => {
    fetchAnalytics(selectedMonth, selectedYear);
  }, [selectedMonth, selectedYear]);

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
    ctx.clearRect(0, 0, W, H);

    if (daily.length === 0) {
      ctx.fillStyle = "#94a3b8";
      ctx.font = "13px system-ui";
      ctx.textAlign = "center";
      ctx.fillText("No data yet for this month", W / 2, H / 2);
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
    ctx.clearRect(0, 0, W, H);

    if (subjects.length === 0) {
      ctx.fillStyle = "#94a3b8";
      ctx.font = "13px system-ui";
      ctx.textAlign = "center";
      ctx.fillText("No data yet for this month", W / 2, H / 2);
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
      const c = s.pct >= targetPct ? "#16a34a" : s.pct >= targetPct - 15 ? "#d97706" : "#dc2626";

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
  }, [data, targetPct]);

  const handleExportPDF = () => {
    if (!data) return;
    const { student, month, year, total, present, absent, pct, subjects, records } = data;
    const pctColor = pct >= targetPct ? "#16a34a" : pct >= targetPct - 15 ? "#d97706" : "#dc2626";

    const printWin = window.open("", "_blank");
    if (!printWin) {
      alert("Please allow popups to generate PDF report.");
      return;
    }

    const rowsHtml = (records || [])
      .map(
        (r) => `
        <tr>
          <td style="white-space:nowrap;font-weight:600;">${r.date}</td>
          <td style="font-weight:500;">${r.subject}</td>
          <td style="color:#64748b;">${r.teacher || "—"}</td>
          <td style="color:#64748b;">${r.classTiming || "—"}</td>
          <td style="color:#64748b;">${r.subjectType || "—"}</td>
          <td>
            <span style="display:inline-block;padding:2px 8px;border-radius:12px;font-size:10px;font-weight:700;${r.status === "Present"
            ? "background:#dcfce7;color:#15803d;"
            : r.status === "Absent"
              ? "background:#fee2e2;color:#b91c1c;"
              : "background:#f1f5f9;color:#64748b;"
          }">${r.status}</span>
          </td>
        </tr>`
      )
      .join("");

    const subjectsHtml = (subjects || [])
      .map(
        (s) => `
        <tr>
          <td style="font-weight:600;">${s.name}</td>
          <td style="color:#15803d;font-weight:600;">${s.present}</td>
          <td style="color:#b91c1c;font-weight:600;">${s.absent}</td>
          <td style="font-weight:600;">${s.total}</td>
          <td style="font-weight:700;color:${s.pct >= targetPct ? "#15803d" : s.pct >= targetPct - 15 ? "#b45309" : "#b91c1c"};">${s.pct}%</td>
        </tr>`
      )
      .join("");

    const htmlContent = `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8" />
          <title>Attendance_Report_${month}_${year}_${student.enrollmentId}</title>
          <style>
            @page { size: A4; margin: 12mm; }
            body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #0f172a; margin: 0; padding: 20px; background: #fff; line-height: 1.5; }
            .header-bar { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #2563eb; padding-bottom: 16px; margin-bottom: 20px; }
            .title { font-size: 22px; font-weight: 800; color: #1e3a8a; margin: 0; }
            .subtitle { font-size: 12px; color: #64748b; margin-top: 4px; }
            .badge-month { background: #eff6ff; color: #1d4ed8; border: 1px solid #bfdbfe; padding: 6px 14px; border-radius: 12px; font-weight: 700; font-size: 13px; text-align: right; }
            
            .meta-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 14px; margin-bottom: 20px; font-size: 12px; }
            .meta-item span { color: #64748b; font-weight: 500; }
            .meta-item strong { color: #0f172a; }

            .stats-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 24px; }
            .stat-card { background: #fff; border: 1px solid #e2e8f0; border-radius: 12px; padding: 12px; text-align: center; }
            .stat-val { font-size: 22px; font-weight: 800; line-height: 1; }
            .stat-lbl { font-size: 10px; color: #64748b; font-weight: 700; text-transform: uppercase; margin-top: 6px; }

            .section-header { font-size: 14px; font-weight: 700; color: #1e293b; margin-bottom: 10px; padding-bottom: 4px; border-bottom: 1px solid #e2e8f0; }

            table { width: 100%; border-collapse: collapse; margin-bottom: 24px; font-size: 11px; }
            th { background: #f1f5f9; text-align: left; padding: 8px 10px; font-weight: 700; color: #475569; text-transform: uppercase; border-bottom: 2px solid #cbd5e1; }
            td { padding: 8px 10px; border-bottom: 1px solid #e2e8f0; }
            tr:nth-child(even) { background: #f8fafc; }

            .footer { margin-top: 30px; border-top: 1px solid #e2e8f0; padding-top: 12px; font-size: 10px; color: #94a3b8; text-align: center; }
          </style>
        </head>
        <body>
          <div class="header-bar">
            <div>
              <h1 class="title">College Attendance Report</h1>
              <div class="subtitle">Official Academic Attendance Summary & Logs</div>
            </div>
            <div class="badge-month">
              ${month} ${year}<br/>
              <span style="font-size:10px;font-weight:500;color:#2563eb;">Target: ${targetPct}%</span>
            </div>
          </div>

          <div class="meta-grid">
            <div class="meta-item"><span>Student Name:</span> <strong>${student.name}</strong></div>
            <div class="meta-item"><span>Enrollment ID:</span> <strong>${student.enrollmentId}</strong></div>
            <div class="meta-item"><span>Class & Section:</span> <strong>${student.className}</strong></div>
            <div class="meta-item"><span>Stream / Branch:</span> <strong>${student.stream}</strong></div>
          </div>

          <div class="stats-grid">
            <div class="stat-card">
              <div class="stat-val" style="color:#2563eb;">${total}</div>
              <div class="stat-lbl">Total Classes</div>
            </div>
            <div class="stat-card">
              <div class="stat-val" style="color:#16a34a;">${present}</div>
              <div class="stat-lbl">Present</div>
            </div>
            <div class="stat-card">
              <div class="stat-val" style="color:#dc2626;">${absent}</div>
              <div class="stat-lbl">Absent</div>
            </div>
            <div class="stat-card">
              <div class="stat-val" style="color:${pctColor};">${pct}%</div>
              <div class="stat-lbl">Attendance Score</div>
            </div>
          </div>

          <div class="section-header">Subject-wise Summary</div>
          <table>
            <thead>
              <tr>
                <th>Subject Name</th>
                <th>Present</th>
                <th>Absent</th>
                <th>Total</th>
                <th>Percentage</th>
              </tr>
            </thead>
            <tbody>
              ${subjectsHtml}
            </tbody>
          </table>

          <div class="section-header">Detailed Class Logs (${records ? records.length : 0} Lectures)</div>
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Subject</th>
                <th>Teacher</th>
                <th>Timing</th>
                <th>Type</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              ${rowsHtml}
            </tbody>
          </table>

          <div class="footer">
            Generated on ${new Date().toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" })} • College Attendance Monitor
          </div>

          <script>
            window.onload = function() {
              setTimeout(function() {
                window.print();
              }, 400);
            };
          </script>
        </body>
      </html>
    `;

    printWin.document.write(htmlContent);
    printWin.document.close();
  };

  if (loading) {
    return <div className="text-center py-12 text-slate-400 text-sm">Loading analytics...</div>;
  }

  if (error || !data) {
    return (
      <div className="text-center py-12">
        <div className="text-red-500 text-sm mb-3">{error || "Could not load analytics"}</div>
        <button
          onClick={() => fetchAnalytics(selectedMonth, selectedYear)}
          className="px-4 py-2 bg-blue-600 text-white rounded-xl text-xs font-semibold hover:bg-blue-700 transition"
        >
          Try Again
        </button>
      </div>
    );
  }

  const { pct, present, absent, total, subjects, records } = data;

  // Dynamic math based on targetPct
  const pctColor = pct >= targetPct ? "#16a34a" : pct >= targetPct - 15 ? "#d97706" : "#dc2626";
  const needed = pct < targetPct ? Math.ceil((targetPct * total - 100 * present) / (100 - targetPct)) : 0;
  const canSkip = pct >= targetPct && total > 0 ? Math.floor((100 * present - targetPct * total) / targetPct) : 0;

  const healthMsg =
    pct >= targetPct
      ? `Safe zone! You are above your ${targetPct}% target. ${canSkip > 0 ? `You can miss up to ${canSkip} upcoming class(es).` : "Keep attending!"}`
      : pct >= targetPct - 15
        ? `Needs attention. ${needed > 0 ? `Need ${needed} consecutive present(s) to reach ${targetPct}%.` : "Keep attending."}`
        : `Critical attendance! ${needed > 0 ? `Must attend next ${needed} class(es) to reach ${targetPct}%.` : "Attend all classes immediately."}`;

  const sortedRecords = [...(records || [])].sort((a, b) => b.date.localeCompare(a.date));

  // Subject Modal Data
  const modalRecords = activeSubjectModal
    ? sortedRecords.filter((r) => r.subject === activeSubjectModal && (modalFilter === "All" || r.status === modalFilter))
    : [];
  const activeSubjectObj = subjects.find((s) => s.name === activeSubjectModal);

  return (
    <div>
      {/* Month, Year & Action Bar */}
      <div className="bg-white rounded-2xl p-4 mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          {/* Month Select */}
          <select
            value={selectedMonth}
            onChange={(e) => setSelectedMonth(Number(e.target.value))}
            className="px-3 py-2 bg-slate-100 border-none rounded-xl text-xs font-semibold text-slate-700 cursor-pointer focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            {MONTHS.slice(0, selectedYear === currentDate.getFullYear() ? currentDate.getMonth() + 1 : 12).map((m, i) => (
              <option key={i} value={i + 1}>
                {m}
              </option>
            ))}
          </select>

          {/* Year Select */}
          <select
            value={selectedYear}
            onChange={(e) => {
              const newYear = Number(e.target.value);
              setSelectedYear(newYear);
              const maxM = newYear === currentDate.getFullYear() ? currentDate.getMonth() + 1 : 12;
              if (selectedMonth > maxM) {
                setSelectedMonth(maxM);
              }
            }}
            className="px-3 py-2 bg-slate-100 border-none rounded-xl text-xs font-semibold text-slate-700 cursor-pointer focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value={2024}>2024</option>
            <option value={2025}>2025</option>
            <option value={2026}>2026</option>
          </select>
        </div>

        {/* Export Button */}
        <button
          onClick={handleExportPDF}
          className="flex items-center gap-1.5 px-3.5 py-2 bg-red-50 text-red-600 hover:bg-red-100 transition rounded-xl text-xs font-semibold border-none cursor-pointer"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
          </svg>
          Export Report
        </button>
      </div>

      {/* Target Setter Bar */}
      <div className="bg-white rounded-2xl p-4 mb-4">
        <div className="flex items-center justify-between mb-2">
          <label className="text-xs font-semibold text-slate-600">Target Attendance %</label>
          <span className="text-xs font-bold text-blue-600 bg-blue-50 px-2 py-0.5 rounded-md">{targetPct}% Target</span>
        </div>
        <div className="flex items-center gap-3">
          <input
            type="range"
            min="50"
            max="95"
            step="5"
            value={targetPct}
            onChange={(e) => setTargetPct(Number(e.target.value))}
            className="flex-1 accent-blue-600 cursor-pointer"
          />
          <div className="flex gap-1">
            {[75, 80, 85, 90].map((t) => (
              <button
                key={t}
                onClick={() => setTargetPct(t)}
                className={`px-2 py-1 text-[10px] font-semibold rounded-lg transition border-none cursor-pointer ${targetPct === t ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                  }`}
              >
                {t}%
              </button>
            ))}
          </div>
        </div>
      </div>

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

      {/* Overall Attendance Progress */}
      <div className="bg-white rounded-2xl p-5 mb-4">
        <h2 className="text-sm font-semibold mb-3 text-slate-900">Overall Attendance ({data.month} {data.year})</h2>
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
              <span className="text-slate-500">Current Score vs {targetPct}% Target</span>
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
        <h2 className="text-sm font-semibold mb-3 text-slate-900">Attendance Health ({targetPct}% Target)</h2>
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
        <p className="text-sm text-slate-600 font-medium">{healthMsg}</p>
      </div>

      {/* Interactive Subject Progress List */}
      <div className="bg-white rounded-2xl p-5 mb-4">
        <div className="flex justify-between items-center mb-3">
          <h2 className="text-sm font-semibold text-slate-900">Subject Progress</h2>
          <span className="text-[11px] text-slate-400">Click a subject to view date-wise history</span>
        </div>
        <div className="space-y-1">
          {subjects.length === 0 ? (
            <div className="text-center py-8 text-slate-400 text-sm">No data yet</div>
          ) : (
            subjects.map((s, idx) => {
              const c = s.pct >= targetPct ? "#16a34a" : s.pct >= targetPct - 15 ? "#d97706" : "#dc2626";
              return (
                <div
                  key={idx}
                  onClick={() => {
                    setActiveSubjectModal(s.name);
                    setModalFilter("All");
                  }}
                  className="flex items-center gap-2.5 p-2 rounded-xl hover:bg-slate-50 border border-transparent hover:border-slate-100 transition cursor-pointer group"
                >
                  <div className="w-20 sm:w-28 text-xs font-semibold truncate shrink-0 group-hover:text-blue-600 transition">
                    {s.name}
                  </div>
                  <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all duration-500"
                      style={{ width: `${s.pct}%`, background: c }}
                    ></div>
                  </div>
                  <div className="w-10 text-right text-xs font-bold shrink-0" style={{ color: c }}>
                    {s.pct}%
                  </div>
                  <div className="text-[11px] text-slate-400 w-12 text-right shrink-0">
                    {s.present}/{s.total}
                  </div>
                  <svg className="w-4 h-4 text-slate-300 group-hover:text-blue-500 transition shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5l7 7-7 7" />
                  </svg>
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
              {sortedRecords.slice(0, 40).length === 0 ? (
                <tr>
                  <td colSpan={6} className="text-center py-8 text-slate-400">
                    No records
                  </td>
                </tr>
              ) : (
                sortedRecords.slice(0, 40).map((r, idx) => {
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

      {/* Subject Detailed History Modal */}
      {activeSubjectModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm animate-fadeIn">
          <div className="bg-white rounded-3xl p-6 max-w-lg w-full max-h-[85vh] flex flex-col shadow-2xl">
            {/* Modal Header */}
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div>
                <h3 className="text-base font-bold text-slate-900">{activeSubjectModal}</h3>
                <p className="text-xs text-slate-400">Detailed Lecture History</p>
              </div>
              <button
                onClick={() => setActiveSubjectModal(null)}
                className="w-8 h-8 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-500 flex items-center justify-center transition border-none cursor-pointer"
              >
                ✕
              </button>
            </div>

            {/* Subject Stat Banner */}
            {activeSubjectObj && (
              <div className="grid grid-cols-3 gap-2 my-4 bg-slate-50 p-3 rounded-2xl">
                <div className="text-center">
                  <div className="text-xs text-slate-400">Attended</div>
                  <div className="text-sm font-bold text-green-600">{activeSubjectObj.present} / {activeSubjectObj.total}</div>
                </div>
                <div className="text-center border-x border-slate-200">
                  <div className="text-xs text-slate-400">Absent</div>
                  <div className="text-sm font-bold text-red-500">{activeSubjectObj.absent}</div>
                </div>
                <div className="text-center">
                  <div className="text-xs text-slate-400">Score</div>
                  <div className="text-sm font-bold text-blue-600">{activeSubjectObj.pct}%</div>
                </div>
              </div>
            )}

            {/* Filter Pills */}
            <div className="flex gap-2 mb-3">
              {(["All", "Present", "Absent"] as const).map((st) => (
                <button
                  key={st}
                  onClick={() => setModalFilter(st)}
                  className={`px-3 py-1 rounded-xl text-xs font-semibold border-none cursor-pointer transition ${modalFilter === st
                      ? st === "Present"
                        ? "bg-green-600 text-white"
                        : st === "Absent"
                          ? "bg-red-500 text-white"
                          : "bg-slate-900 text-white"
                      : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                    }`}
                >
                  {st}
                </button>
              ))}
            </div>

            {/* Scrollable Records */}
            <div className="flex-1 overflow-y-auto space-y-2 pr-1">
              {modalRecords.length === 0 ? (
                <div className="text-center py-8 text-slate-400 text-sm">No lecture records found for filter "{modalFilter}"</div>
              ) : (
                modalRecords.map((r, i) => {
                  const isP = r.status === "Present";
                  return (
                    <div key={i} className="flex items-center justify-between p-3 rounded-xl bg-slate-50 border border-slate-100">
                      <div>
                        <div className="text-xs font-semibold text-slate-800">{r.date}</div>
                        <div className="text-[11px] text-slate-400">
                          {r.classTiming} {r.teacher ? `• ${r.teacher}` : ""}
                        </div>
                      </div>
                      <span
                        className={`px-2.5 py-1 rounded-full text-[11px] font-bold ${isP ? "bg-green-100 text-green-700" : "bg-red-100 text-red-600"
                          }`}
                      >
                        {r.status}
                      </span>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
