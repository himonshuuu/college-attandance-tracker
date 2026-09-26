import React, { useEffect, useState } from "react";

interface Friend {
  id: number;
  userId: number;
  name: string;
  enrollmentId: string;
  pct: number;
  total: number;
}

interface Request {
  id: number;
  userId: number;
  name: string;
  enrollmentId: string;
}

interface CompareData {
  month: string;
  year: number;
  me: { name: string; total: number; present: number; pct: number };
  friend: { name: string; total: number; present: number; pct: number };
  subjects: Array<{ name: string; mePct: number | null; friendPct: number | null; delta: number | null }>;
}

function initials(name: string): string {
  if (!name) return "?";
  return name.split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase();
}

export const FriendsView: React.FC = () => {
  const [friends, setFriends] = useState<Friend[]>([]);
  const [incoming, setIncoming] = useState<Request[]>([]);
  const [outgoing, setOutgoing] = useState<Request[]>([]);
  const [query, setQuery] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [compareId, setCompareId] = useState<number | null>(null);
  const [compare, setCompare] = useState<CompareData | null>(null);
  const [compareLoading, setCompareLoading] = useState(false);

  const load = async () => {
    try {
      const res = await fetch("/api/friends");
      const data = (await res.json()) as { friends?: Friend[]; incoming?: Request[]; outgoing?: Request[]; error?: string };
      if (!res.ok || data.error) throw new Error(data.error || "Could not load friends");
      setFriends(data.friends || []);
      setIncoming(data.incoming || []);
      setOutgoing(data.outgoing || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load friends");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    if (compareId == null) {
      setCompare(null);
      return;
    }
    setCompareLoading(true);
    fetch(`/api/friends/compare/${compareId}`)
      .then((res) => {
        if (!res.ok) throw new Error("Could not load comparison");
        return res.json();
      })
      .then((d: unknown) => setCompare(d as CompareData))
      .catch((err: Error) => setError(err.message))
      .finally(() => setCompareLoading(false));
  }, [compareId]);

  const sendRequest = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError("");
    setMessage("");
    if (!query.trim()) return;
    setSending(true);
    try {
      const res = await fetch("/api/friends", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query }),
      });
      const data = (await res.json()) as { message?: string; error?: string };
      if (!res.ok || data.error) {
        setError(data.error || "Could not send request");
      } else {
        setMessage(data.message || "Request sent!");
        setQuery("");
        load();
      }
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setSending(false);
    }
  };

  const act = async (id: number, action: "accept" | "decline" | "remove") => {
    setError("");
    try {
      const url = action === "remove" ? `/api/friends/${id}` : `/api/friends/${id}/${action}`;
      const res = await fetch(url, { method: action === "remove" ? "DELETE" : "POST" });
      if (!res.ok) throw new Error("Action failed");
      if (compareId != null) setCompareId(null);
      load();
    } catch {
      setError("Action failed. Please try again.");
    }
  };

  if (loading) {
    return <div className="text-center py-12 text-slate-400 text-sm">Loading friends...</div>;
  }

  return (
    <div>
      {/* Incoming requests */}
      {incoming.length > 0 && (
        <div className="bg-white rounded-2xl p-4 sm:p-5 mb-4">
          <h2 className="text-sm font-semibold mb-3 text-slate-900">Requests ({incoming.length})</h2>
          <div className="space-y-2">
            {incoming.map((r) => (
              <div key={r.id} className="flex items-center gap-3 bg-slate-50 rounded-xl p-3">
                <div className="w-10 h-10 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center font-bold text-xs shrink-0">
                  {initials(r.name)}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold text-slate-900 truncate">{r.name}</div>
                  <div className="text-[11px] text-slate-400">wants to compare attendance</div>
                </div>
                <button
                  type="button"
                  onClick={() => act(r.id, "accept")}
                  className="px-3 py-2 rounded-xl border-none bg-blue-600 text-white text-xs font-semibold cursor-pointer min-h-[44px]"
                >
                  Accept
                </button>
                <button
                  type="button"
                  onClick={() => act(r.id, "decline")}
                  className="px-3 py-2 rounded-xl border-none bg-slate-200 text-slate-600 text-xs font-semibold cursor-pointer min-h-[44px]"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Compare card */}
      {compareId != null && (
        <div className="bg-white rounded-2xl p-4 sm:p-5 mb-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-slate-900">
              {compareLoading ? "Comparing..." : compare ? `You vs ${compare.friend.name}` : ""}
            </h2>
            <button
              type="button"
              onClick={() => setCompareId(null)}
              className="w-9 h-9 rounded-full bg-slate-100 text-slate-500 border-none cursor-pointer flex items-center justify-center"
              aria-label="Close comparison"
            >
              ✕
            </button>
          </div>
          {!compareLoading && compare && (
            <>
              <div className="grid grid-cols-2 gap-2 mb-4">
                {[
                  { label: "You", pct: compare.me.pct, detail: `${compare.me.present}/${compare.me.total}` },
                  { label: compare.friend.name, pct: compare.friend.pct, detail: `${compare.friend.present}/${compare.friend.total}` },
                ].map((p, i) => (
                  <div key={i} className="bg-slate-50 rounded-xl p-3 text-center">
                    <div className="text-[11px] font-semibold text-slate-400 truncate">{p.label}</div>
                    <div className={`text-2xl font-black ${p.pct >= 75 ? "text-green-600" : p.pct >= 60 ? "text-amber-600" : "text-red-500"}`}>
                      {p.pct}%
                    </div>
                    <div className="text-[11px] text-slate-400">{p.detail} classes</div>
                  </div>
                ))}
              </div>
              <div className="space-y-2">
                {compare.subjects.map((s) => (
                  <div key={s.name} className="bg-slate-50 rounded-xl p-3">
                    <div className="flex justify-between items-center mb-1.5">
                      <span className="text-xs font-semibold text-slate-700 truncate">{s.name}</span>
                      {s.delta != null && (
                        <span className={`text-[11px] font-bold ${s.delta > 0 ? "text-green-600" : s.delta < 0 ? "text-red-500" : "text-slate-400"}`}>
                          {s.delta > 0 ? `+${s.delta}` : s.delta}%
                        </span>
                      )}
                    </div>
                    <div className="space-y-1">
                      {[
                        { who: "You", pct: s.mePct, color: "#2563eb" },
                        { who: compare.friend.name, pct: s.friendPct, color: "#f59e0b" },
                      ].map((row, j) => (
                        <div key={j} className="flex items-center gap-2">
                          <span className="w-16 text-[10px] text-slate-400 truncate shrink-0">{row.who}</span>
                          <div className="flex-1 h-2 bg-slate-200 rounded-full overflow-hidden">
                            <div className="h-full rounded-full" style={{ width: `${row.pct ?? 0}%`, background: row.color }}></div>
                          </div>
                          <span className="w-9 text-right text-[11px] font-bold text-slate-600 shrink-0">
                            {row.pct != null ? `${row.pct}%` : "—"}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
              <p className="text-[11px] text-slate-400 text-center mt-3">{compare.month} {compare.year}</p>
              <div className="text-center mt-2">
                <button
                  type="button"
                  onClick={() => {
                    const f = friends.find((x) => x.userId === compareId);
                    if (f && window.confirm(`Remove ${f.name} from friends?`)) act(f.id, "remove");
                  }}
                  className="text-[11px] text-slate-400 border-none bg-transparent cursor-pointer min-h-[44px]"
                >
                  Remove friend
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {/* Friends list */}
      <div className="bg-white rounded-2xl p-4 sm:p-5 mb-4">
        <h2 className="text-sm font-semibold mb-1 text-slate-900">My Friends ({friends.length})</h2>
        <p className="text-[11px] text-slate-400 mb-3">Tap a friend to compare subject-wise attendance.</p>
        {friends.length === 0 ? (
          <div className="text-center py-6">
            <div className="text-3xl mb-2">👥</div>
            <p className="text-xs text-slate-500 font-medium">No friends yet.</p>
            <p className="text-[11px] text-slate-400 mt-1 leading-relaxed">
              Add a classmate below to compare attendance and push each other up the leaderboard.
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {friends.map((f) => (
              <button
                key={f.id}
                type="button"
                onClick={() => setCompareId(compareId === f.userId ? null : f.userId)}
                className={`w-full flex items-center gap-3 rounded-xl p-3 border cursor-pointer text-left transition min-h-[56px] ${compareId === f.userId ? "bg-blue-50 border-blue-200" : "bg-slate-50 border-transparent"}`}
              >
                <div className="w-10 h-10 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center font-bold text-xs shrink-0">
                  {initials(f.name)}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold text-slate-900 truncate">{f.name}</div>
                  <div className="h-1.5 bg-slate-200 rounded-full overflow-hidden mt-1">
                    <div
                      className="h-full rounded-full"
                      style={{ width: `${f.pct}%`, background: f.pct >= 75 ? "#16a34a" : f.pct >= 60 ? "#d97706" : "#dc2626" }}
                    ></div>
                  </div>
                </div>
                <div className="text-sm font-black text-slate-700 shrink-0">{f.pct}%</div>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Add friend */}
      <div className="bg-white rounded-2xl p-4 sm:p-5 mb-4">
        <h2 className="text-sm font-semibold mb-1 text-slate-900">Add a Friend</h2>
        <p className="text-[11px] text-slate-400 mb-3">Enter their account email or enrollment ID. They'll approve your request.</p>
        <form onSubmit={sendRequest} className="flex gap-2">
          <input
            type="text"
            value={query}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setQuery(e.target.value)}
            placeholder="Email or enrollment ID"
            autoComplete="off"
            className="flex-1 min-w-0 px-3.5 py-2.5 rounded-xl border-none bg-slate-100 text-sm outline-none min-h-[44px]"
          />
          <button
            type="submit"
            disabled={sending}
            className="px-4 rounded-xl border-none bg-blue-600 text-white text-sm font-semibold cursor-pointer disabled:opacity-50 min-h-[44px] shrink-0"
          >
            {sending ? "..." : "Add"}
          </button>
        </form>
        {outgoing.length > 0 && (
          <div className="mt-3 space-y-1.5">
            {outgoing.map((r) => (
              <div key={r.id} className="flex items-center justify-between text-[11px] text-slate-400 bg-slate-50 px-3 py-2 rounded-xl">
                <span className="truncate">⏳ Waiting on {r.name}</span>
                <button
                  type="button"
                  onClick={() => act(r.id, "remove")}
                  className="text-slate-400 border-none bg-transparent cursor-pointer text-xs ml-2 shrink-0"
                >
                  Cancel
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {message && <div className="msg msg-success show p-3 rounded-xl text-sm mb-4">{message}</div>}
      {error && <div className="msg msg-error show p-3 rounded-xl text-sm mb-4">{error}</div>}
    </div>
  );
};
