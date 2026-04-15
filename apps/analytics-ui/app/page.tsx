"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { KpiCard } from "../components/KpiCard";
import { SidebarNav, type NavKey } from "../components/SidebarNav";
import { initDB, loadEventData, syncLiveEvents } from "../lib/duckdb";
import { queryTemplates } from "../lib/queries";

type DashboardRow = Record<string, unknown>;

function safeJson(value: unknown): string {
  return JSON.stringify(
    value,
    (_key, v) => (typeof v === "bigint" ? v.toString() : v),
    2
  );
}

function parseRows(json: string): DashboardRow[] {
  try {
    const parsed = JSON.parse(json) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed as DashboardRow[];
  } catch {
    return [];
  }
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined) {
    return "-";
  }
  if (Array.isArray(value)) {
    return value.join(", ");
  }
  if (typeof value === "object") {
    return JSON.stringify(value);
  }
  return String(value);
}

function safeNumber(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function decisionReason(row: DashboardRow): string {
  const action = String(row.action ?? "");
  const score = safeNumber(row.input_score, 0);
  const leakTypes = Array.isArray(row.leak_types) ? row.leak_types.map(String) : [];
  if (action === "block_input") {
    return `Blocked because input threat score ${score.toFixed(2)} exceeded policy threshold (0.85).`;
  }
  if (action === "terminate_stream") {
    return `Stream terminated due to sensitive output leak (${leakTypes.join(", ") || "unknown type"}).`;
  }
  if (action === "redact_stream") {
    return `Response allowed but sensitive tokens were redacted (${leakTypes.join(", ") || "unknown type"}).`;
  }
  return `Allowed. No policy violation detected for this request.`;
}

export default function Page() {
  const [overview, setOverview] = useState<string>("Loading...");
  const [activeTab, setActiveTab] = useState<"threats" | "leaks" | "users" | "incidents">("threats");
  const [results, setResults] = useState<string>("Loading...");
  const [decisionFeed, setDecisionFeed] = useState<string>("[]");
  const [threatTrend, setThreatTrend] = useState<string>("[]");
  const [error, setError] = useState<string>("");
  const [requestFilter, setRequestFilter] = useState<string>("");
  const [selectedRequest, setSelectedRequest] = useState<DashboardRow | null>(null);
  const [activeNav, setActiveNav] = useState<NavKey>("overview");
  const [refreshTick, setRefreshTick] = useState(0);
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [filterAction, setFilterAction] = useState<string>("all");
  const [filterSeverity, setFilterSeverity] = useState<string>("all");
  const [rowsPerPage, setRowsPerPage] = useState<number>(10);
  const [page, setPage] = useState<number>(1);
  const dataUrl = useMemo(() => process.env.NEXT_PUBLIC_CURATED_PARQUET_URL || "", []);
  const liveEventsUrl = useMemo(() => process.env.NEXT_PUBLIC_PROXY_EVENTS_URL || "http://localhost:18080/debug/events", []);
  const overviewRows = useMemo(() => parseRows(overview), [overview]);
  const detailRows = useMemo(() => parseRows(results), [results]);
  const decisionRows = useMemo(() => parseRows(decisionFeed), [decisionFeed]);
  const trendRows = useMemo(() => parseRows(threatTrend), [threatTrend]);
  const incidentFeed = useMemo(
    () => decisionRows.filter((row) => String(row.action ?? "") !== "allow").slice(0, 8),
    [decisionRows]
  );
  const filteredDecisionRows = useMemo(() => {
    const needle = requestFilter.trim().toLowerCase();
    return decisionRows.filter((row) => {
      const requestID = String(row.request_id ?? "").toLowerCase();
      const userID = String(row.user_id ?? "").toLowerCase();
      const action = String(row.action ?? "").toLowerCase();
      const piiTag = String(row.pii_tag ?? "SAFE").toUpperCase();
      const matchSearch = !needle || requestID.includes(needle) || userID.includes(needle) || action.includes(needle);
      const matchAction = filterAction === "all" || action === filterAction;
      const matchSeverity = filterSeverity === "all" || piiTag === filterSeverity;
      return matchSearch && matchAction && matchSeverity;
    });
  }, [decisionRows, requestFilter, filterAction, filterSeverity]);
  const paginatedDecisionRows = useMemo(() => {
    const start = (page - 1) * rowsPerPage;
    return filteredDecisionRows.slice(start, start + rowsPerPage);
  }, [filteredDecisionRows, page, rowsPerPage]);
  const totalPages = Math.max(1, Math.ceil(filteredDecisionRows.length / rowsPerPage));
  const activeTitle =
    activeTab === "threats"
      ? "Threat Trends"
      : activeTab === "leaks"
        ? "Leak Frequency"
        : activeTab === "users"
          ? "User Behavior"
          : "Critical Incidents";

  const kpi = overviewRows[0] ?? {};
  const totalRequests = decisionRows.length > 0 ? decisionRows.length : safeNumber(kpi.total_requests, 0);
  const blockedRequests =
    decisionRows.length > 0
      ? decisionRows.filter((r) => String(r.action ?? "") === "block_input").length
      : safeNumber(kpi.blocked_requests, 0);
  const leakEvents =
    decisionRows.length > 0
      ? decisionRows.filter((r) => Boolean(r.output_leak)).length
      : safeNumber(kpi.leak_events, 0);
  const avgLatency =
    decisionRows.length > 0
      ? decisionRows.reduce((acc, r) => acc + safeNumber(r.latency_ms, 0), 0) / Math.max(decisionRows.length, 1)
      : safeNumber(kpi.avg_latency_ms, 0);
  const blockRate = totalRequests > 0 ? (blockedRequests / totalRequests) * 100 : 0;
  const leakRate = totalRequests > 0 ? (leakEvents / totalRequests) * 100 : 0;

  const sectionRefs = {
    overview: useRef<HTMLElement>(null),
    explorer: useRef<HTMLElement>(null),
    trends: useRef<HTMLElement>(null),
    leaks: useRef<HTMLElement>(null),
    users: useRef<HTMLElement>(null),
    incidents: useRef<HTMLElement>(null)
  };

  useEffect(() => {
    (async () => {
      try {
        const { conn } = await initDB();
        await loadEventData(conn, dataUrl || undefined);
        await syncLiveEvents(conn, liveEventsUrl);
        const overviewResult = await conn.query(queryTemplates.overview);
        setOverview(safeJson(overviewResult.toArray()));

        const query =
          activeTab === "threats"
            ? queryTemplates.attackTrends
            : activeTab === "leaks"
              ? queryTemplates.leakFrequency
              : activeTab === "users"
                ? queryTemplates.userBehavior
                : queryTemplates.criticalIncidents;
        const detailResult = await conn.query(query);
        setResults(safeJson(detailResult.toArray()));
        const decisionResult = await conn.query(queryTemplates.decisionFeed);
        setDecisionFeed(safeJson(decisionResult.toArray()));
        const trendResult = await conn.query(queryTemplates.attackTrends);
        setThreatTrend(safeJson(trendResult.toArray()));
      } catch (e) {
        setError(`Query error: ${String(e)}`);
      }
    })();
  }, [activeTab, dataUrl, liveEventsUrl, refreshTick]);

  useEffect(() => {
    const t = setInterval(() => {
      setRefreshTick((x) => x + 1);
    }, 5000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
        if (visible?.target?.id) {
          setActiveNav(visible.target.id as NavKey);
        }
      },
      { threshold: [0.35, 0.5, 0.75] }
    );
    Object.values(sectionRefs).forEach((ref) => {
      if (ref.current) {
        observer.observe(ref.current);
      }
    });
    return () => observer.disconnect();
  }, []);

  const jumpTo = (key: NavKey) => {
    sectionRefs[key].current?.scrollIntoView({ behavior: "smooth", block: "start" });
    setActiveNav(key);
    if (key === "trends") setActiveTab("threats");
    if (key === "leaks") setActiveTab("leaks");
    if (key === "users") setActiveTab("users");
    if (key === "incidents") setActiveTab("incidents");
  };

  return (
    <main
      style={{
        minHeight: "100vh",
        padding: 24,
        background: theme === "light" ? "linear-gradient(180deg, #f8fafc 0%, #eef2ff 100%)" : "linear-gradient(180deg, #0f172a 0%, #111827 100%)",
        fontFamily: "Inter, Arial, sans-serif",
        color: theme === "light" ? "#0f172a" : "#e5e7eb"
      }}
    >
      <div style={{ maxWidth: 1300, margin: "0 auto", display: "grid", gridTemplateColumns: "240px 1fr", gap: 16 }}>
        <SidebarNav active={activeNav} onSelect={jumpTo} />

        <section>
          <header style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 14, padding: 18, marginBottom: 14 }}>
            <h1 style={{ margin: "0 0 6px 0" }}>ViperGo Security Analytics</h1>
            <p style={{ margin: 0, color: "#64748b" }}>
              Request-level AI firewall decisions, threat scoring, stream leak prevention, and incident visibility.
            </p>
            <div style={{ marginTop: 10, display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button onClick={() => setTheme((t) => (t === "light" ? "dark" : "light"))} style={{ padding: "6px 10px" }}>
                Theme: {theme}
              </button>
              <button
                onClick={() => {
                  const rows = filteredDecisionRows;
                  const cols = ["timestamp", "request_id", "user_id", "action", "input_score", "output_leak", "pii_tag", "latency_ms"];
                  const csv = [cols.join(","), ...rows.map((r) => cols.map((c) => `"${String(r[c] ?? "").replaceAll("\"", "\"\"")}"`).join(","))].join("\n");
                  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement("a");
                  a.href = url;
                  a.download = "vipergo-request-explorer.csv";
                  a.click();
                  URL.revokeObjectURL(url);
                }}
                style={{ padding: "6px 10px" }}
              >
                Export CSV
              </button>
            </div>
          </header>

          {error ? (
            <div style={{ padding: 12, border: "1px solid #d33", borderRadius: 8, background: "#fff5f5", marginBottom: 16 }}>{error}</div>
          ) : null}

          <section id="overview" ref={sectionRefs.overview} style={{ marginBottom: 16 }}>
            <h2 style={{ marginBottom: 10 }}>Overview KPIs</h2>
            {overviewRows.length === 0 ? (
              <div style={{ padding: 12, borderRadius: 8, background: "#f8fafc", border: "1px solid #e2e8f0" }}>No KPI data yet.</div>
            ) : (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12 }}>
                <KpiCard title="Total Requests" value={String(totalRequests)} border="#e5e7eb" bg="#fff" accent="#6b7280" />
                <KpiCard title="Blocked Requests" value={String(blockedRequests)} subtitle={`${blockRate.toFixed(1)}% of all traffic`} border="#fecaca" bg="#fff1f2" accent="#9f1239" />
                <KpiCard title="Leak Events" value={String(leakEvents)} subtitle={`${leakRate.toFixed(1)}% leak rate`} border="#fde68a" bg="#fffbeb" accent="#92400e" />
                <KpiCard title="Avg Latency" value={`${avgLatency.toFixed(1)}ms`} border="#bfdbfe" bg="#eff6ff" accent="#1d4ed8" />
              </div>
            )}
          </section>

          <section id="trends" ref={sectionRefs.trends} style={{ marginBottom: 16, display: "grid", gridTemplateColumns: "2fr 1fr", gap: 12 }}>
            <article style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 12, padding: 12 }}>
              <h3 style={{ margin: "0 0 10px 0" }}>Blocked Request Trend</h3>
              {trendRows.length === 0 ? (
                <div style={{ color: "#64748b", fontSize: 13 }}>No trend points yet.</div>
              ) : (
                <div style={{ width: "100%", height: 240 }}>
                  <ResponsiveContainer>
                    <LineChart data={trendRows.map((r) => ({ hour: formatValue(r.hour), blocked: safeNumber(r.blocked, 0) }))}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="hour" hide />
                      <YAxis />
                      <Tooltip />
                      <Line type="monotone" dataKey="blocked" stroke="#ef4444" strokeWidth={2} dot={false} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              )}
            </article>

            <article style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 12, padding: 12 }}>
              <h3 style={{ margin: "0 0 10px 0" }}>Live Incident Feed</h3>
              <div style={{ display: "grid", gap: 8 }}>
                {incidentFeed.length === 0 ? (
                  <div style={{ color: "#64748b", fontSize: 13 }}>No active incidents.</div>
                ) : (
                  incidentFeed.map((row, idx) => (
                    <button
                      key={idx}
                      onClick={() => setSelectedRequest(row)}
                      style={{
                        textAlign: "left",
                        border: "1px solid #e2e8f0",
                        borderRadius: 8,
                        background: "#fff",
                        padding: 8,
                        cursor: "pointer"
                      }}
                    >
                      <div style={{ fontSize: 12, color: "#64748b" }}>{formatValue(row.timestamp)}</div>
                      <div style={{ fontSize: 13, fontWeight: 700 }}>{formatValue(row.action)}</div>
                      <div style={{ fontSize: 12, color: "#334155" }}>request: {formatValue(row.request_id)}</div>
                    </button>
                  ))
                )}
              </div>
            </article>
          </section>

          <section id="explorer" ref={sectionRefs.explorer} style={{ marginBottom: 20 }}>
            <h2 style={{ marginBottom: 8 }}>Request Explorer (What happened and why)</h2>
            <p style={{ marginTop: 0, color: "#6b7280", fontSize: 14 }}>
              Each row is one request decision. This shows who triggered it, what action was taken, the score, and why.
            </p>
            <input
              placeholder="Filter by request id, user, or action..."
              value={requestFilter}
              onChange={(e) => setRequestFilter(e.target.value)}
              style={{ width: "100%", maxWidth: 420, padding: "8px 10px", border: "1px solid #d1d5db", borderRadius: 8, marginBottom: 10 }}
            />
            <div style={{ display: "flex", gap: 8, marginBottom: 10, flexWrap: "wrap" }}>
              <select value={filterAction} onChange={(e) => { setFilterAction(e.target.value); setPage(1); }} style={{ padding: "8px 10px" }}>
                <option value="all">Action: All</option>
                <option value="allow">allow</option>
                <option value="block_input">block_input</option>
                <option value="redact_stream">redact_stream</option>
                <option value="terminate_stream">terminate_stream</option>
              </select>
              <select value={filterSeverity} onChange={(e) => { setFilterSeverity(e.target.value); setPage(1); }} style={{ padding: "8px 10px" }}>
                <option value="all">Severity: All</option>
                <option value="SAFE">SAFE</option>
                <option value="RED_FLAG">RED_FLAG</option>
                <option value="CRITICAL">CRITICAL</option>
              </select>
              <select value={rowsPerPage} onChange={(e) => { setRowsPerPage(Number(e.target.value)); setPage(1); }} style={{ padding: "8px 10px" }}>
                <option value={10}>10 rows</option>
                <option value={20}>20 rows</option>
                <option value={50}>50 rows</option>
              </select>
            </div>
            {filteredDecisionRows.length === 0 ? (
              <div style={{ padding: 12, borderRadius: 8, background: "#f8fafc", border: "1px solid #e2e8f0" }}>No request records match this filter.</div>
            ) : (
              <div style={{ border: "1px solid #e5e7eb", borderRadius: 10, overflow: "auto", background: "#fff" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 1050 }}>
                  <thead style={{ background: "#f9fafb" }}>
                    <tr>
                      {["timestamp", "request_id", "user_id", "action", "input_score", "output_leak", "pii_tag", "latency_ms", "reason"].map((col) => (
                        <th key={col} style={{ textAlign: "left", padding: 10, borderBottom: "1px solid #e5e7eb", fontSize: 13 }}>
                          {col.replaceAll("_", " ")}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {paginatedDecisionRows.map((row, idx) => {
                      const action = String(row.action ?? "");
                      const actionBg =
                        action === "block_input"
                          ? "#fee2e2"
                          : action === "redact_stream"
                            ? "#fef3c7"
                            : action === "terminate_stream"
                              ? "#fecaca"
                              : "#dcfce7";
                      const actionColor =
                        action === "block_input" || action === "terminate_stream"
                          ? "#991b1b"
                          : action === "redact_stream"
                            ? "#92400e"
                            : "#166534";
                      return (
                        <tr key={idx} onClick={() => setSelectedRequest(row)} style={{ cursor: "pointer" }}>
                          <td style={{ padding: 10, borderBottom: "1px solid #f1f5f9", fontSize: 13 }}>{formatValue(row.timestamp)}</td>
                          <td style={{ padding: 10, borderBottom: "1px solid #f1f5f9", fontSize: 13 }}>{formatValue(row.request_id)}</td>
                          <td style={{ padding: 10, borderBottom: "1px solid #f1f5f9", fontSize: 13 }}>{formatValue(row.user_id)}</td>
                          <td style={{ padding: 10, borderBottom: "1px solid #f1f5f9", fontSize: 13 }}>
                            <span style={{ padding: "3px 8px", borderRadius: 999, background: actionBg, color: actionColor, fontWeight: 700 }}>
                              {formatValue(row.action)}
                            </span>
                          </td>
                          <td style={{ padding: 10, borderBottom: "1px solid #f1f5f9", fontSize: 13 }}>{formatValue(row.input_score)}</td>
                          <td style={{ padding: 10, borderBottom: "1px solid #f1f5f9", fontSize: 13 }}>{formatValue(row.output_leak)}</td>
                          <td style={{ padding: 10, borderBottom: "1px solid #f1f5f9", fontSize: 13 }}>{formatValue(row.pii_tag)}</td>
                          <td style={{ padding: 10, borderBottom: "1px solid #f1f5f9", fontSize: 13 }}>{formatValue(row.latency_ms)}</td>
                          <td style={{ padding: 10, borderBottom: "1px solid #f1f5f9", fontSize: 13, maxWidth: 420 }}>{decisionReason(row)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            <div style={{ marginTop: 10, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div style={{ fontSize: 12, color: "#64748b" }}>
                Showing {(page - 1) * rowsPerPage + 1}-{Math.min(page * rowsPerPage, filteredDecisionRows.length)} of {filteredDecisionRows.length}
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1} style={{ padding: "6px 10px" }}>Prev</button>
                <span style={{ fontSize: 13, alignSelf: "center" }}>Page {page} / {totalPages}</span>
                <button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page >= totalPages} style={{ padding: "6px 10px" }}>Next</button>
              </div>
            </div>
          </section>

          <section style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
            <button onClick={() => setActiveTab("threats")} style={{ padding: "8px 12px" }}>Threat Trends</button>
            <button onClick={() => setActiveTab("leaks")} style={{ padding: "8px 12px" }}>Leak Frequency</button>
            <button onClick={() => setActiveTab("users")} style={{ padding: "8px 12px" }}>User Behavior</button>
            <button onClick={() => setActiveTab("incidents")} style={{ padding: "8px 12px" }}>Critical Incidents</button>
          </section>
          <section
            id={activeTab === "leaks" ? "leaks" : activeTab === "users" ? "users" : activeTab === "incidents" ? "incidents" : "trends"}
            ref={
              activeTab === "leaks"
                ? sectionRefs.leaks
                : activeTab === "users"
                  ? sectionRefs.users
                  : activeTab === "incidents"
                    ? sectionRefs.incidents
                    : sectionRefs.trends
            }
            style={{ marginBottom: 20 }}
          >
            <h2 style={{ marginBottom: 8 }}>{activeTitle}</h2>
            {detailRows.length === 0 ? (
              <div style={{ padding: 12, borderRadius: 8, background: "#f8fafc", border: "1px solid #e2e8f0" }}>No rows found for this query.</div>
            ) : (
              <div style={{ border: "1px solid #e5e7eb", borderRadius: 10, overflow: "auto", background: "#fff" }}>
                {activeTab === "leaks" ? (
                  <div style={{ width: "100%", height: 260, padding: 10 }}>
                    <ResponsiveContainer>
                      <BarChart data={detailRows.map((r) => ({ leak_type: formatValue(r.leak_type), cnt: safeNumber(r.cnt, 0) }))}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis dataKey="leak_type" />
                        <YAxis />
                        <Tooltip />
                        <Bar dataKey="cnt" fill="#f59e0b" />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                ) : (
                  <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 700 }}>
                    <thead style={{ background: "#f9fafb" }}>
                      <tr>
                        {Object.keys(detailRows[0]).map((col) => (
                          <th key={col} style={{ textAlign: "left", padding: 10, borderBottom: "1px solid #e5e7eb", fontSize: 13 }}>
                            {col.replaceAll("_", " ")}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {detailRows.map((row, idx) => (
                        <tr key={idx}>
                          {Object.keys(detailRows[0]).map((col) => (
                            <td key={`${idx}-${col}`} style={{ padding: 10, borderBottom: "1px solid #f1f5f9", fontSize: 13 }}>
                              {formatValue(row[col])}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            )}
          </section>

          <section style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 10, padding: 14 }}>
            <h3 style={{ marginTop: 0 }}>How this security flow works</h3>
            <ol style={{ margin: 0, paddingLeft: 18, color: "#374151", lineHeight: 1.6 }}>
              <li>User prompt hits ViperGo proxy.</li>
              <li>Input scanner assigns threat score and may block prompt.</li>
              <li>Allowed traffic streams from LLM and output scanner redacts leaks.</li>
              <li>Events are logged and aggregated for this dashboard.</li>
            </ol>
          </section>
        </section>
      </div>

      {selectedRequest ? (
        <div
          style={{
            position: "fixed",
            top: 0,
            right: 0,
            height: "100vh",
            width: "min(560px, 95vw)",
            background: "#fff",
            borderLeft: "1px solid #e2e8f0",
            boxShadow: "-8px 0 32px rgba(15,23,42,0.15)",
            padding: 16,
            overflow: "auto",
            zIndex: 1000
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <h3 style={{ margin: 0 }}>Request Detail</h3>
            <button onClick={() => setSelectedRequest(null)} style={{ padding: "6px 10px" }}>Close</button>
          </div>
          <p style={{ color: "#64748b", fontSize: 13 }}>Full event details and decision context</p>
          <div style={{ display: "grid", gap: 8 }}>
            {Object.entries(selectedRequest).map(([k, v]) => (
              <div key={k} style={{ border: "1px solid #e2e8f0", borderRadius: 8, padding: 8 }}>
                <div style={{ fontSize: 12, color: "#64748b" }}>{k}</div>
                <div style={{ fontSize: 14 }}>{formatValue(v)}</div>
              </div>
            ))}
          </div>
          <div style={{ marginTop: 12, background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 8, padding: 10 }}>
            <div style={{ fontWeight: 700, marginBottom: 4 }}>Decision Summary</div>
            <div style={{ fontSize: 14 }}>{decisionReason(selectedRequest)}</div>
          </div>
        </div>
      ) : null}
    </main>
  );
}
