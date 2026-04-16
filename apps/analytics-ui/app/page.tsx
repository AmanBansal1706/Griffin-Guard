"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { RequestDetailDrawer } from "../components/dashboard/RequestDetailDrawer";
import { KpiCard } from "../components/KpiCard";
import { SidebarNav, type NavKey } from "../components/SidebarNav";
import { Badge, Button, SectionHeader, SelectInput, TextInput } from "../components/ui/primitives";
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
  const [dataSourceState, setDataSourceState] = useState<"live" | "stale" | "unknown">("unknown");
  const [lastRefreshAt, setLastRefreshAt] = useState<string>("never");
  const isRefreshingRef = useRef(false);
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
    const persisted = localStorage.getItem("vipergo-dashboard-state");
    if (persisted) {
      try {
        const state = JSON.parse(persisted) as { action?: string; severity?: string; rowsPerPage?: number; requestFilter?: string };
        if (state.action) setFilterAction(state.action);
        if (state.severity) setFilterSeverity(state.severity);
        if (state.rowsPerPage) setRowsPerPage(state.rowsPerPage);
        if (state.requestFilter) setRequestFilter(state.requestFilter);
      } catch {
        // ignore
      }
    }
  }, []);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

  useEffect(() => {
    localStorage.setItem(
      "vipergo-dashboard-state",
      JSON.stringify({ action: filterAction, severity: filterSeverity, rowsPerPage, requestFilter })
    );
  }, [filterAction, filterSeverity, rowsPerPage, requestFilter]);

  useEffect(() => {
    (async () => {
      if (isRefreshingRef.current) {
        return;
      }
      isRefreshingRef.current = true;
      try {
        const { conn } = await initDB();
        await loadEventData(conn, dataUrl || undefined);
        const source = await syncLiveEvents(conn, liveEventsUrl);
        setDataSourceState(source);
        setLastRefreshAt(new Date().toLocaleTimeString());
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
      } finally {
        isRefreshingRef.current = false;
      }
    })();
  }, [activeTab, dataUrl, liveEventsUrl, refreshTick]);

  useEffect(() => {
    const t = setInterval(() => {
      if (document.visibilityState === "visible") {
        setRefreshTick((x) => x + 1);
      }
    }, 10000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setSelectedRequest(null);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
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
    <main className="gg-shell">
      <div className="gg-layout">
        <SidebarNav active={activeNav} onSelect={jumpTo} />

        <section>
          <header className="gg-card" style={{ padding: 20, marginBottom: 16 }}>
            <h1 style={{ margin: 0, fontSize: 30 }}>Security Analytics Console</h1>
            <p className="gg-muted" style={{ marginTop: 8, marginBottom: 0 }}>
              Track AI firewall decisions, threat signals, output leak controls, and incident activity in one place.
            </p>
            <div className="gg-muted" style={{ marginTop: 10, fontSize: 12 }}>
              Source: <strong>{dataSourceState}</strong> | Refreshed: <strong>{lastRefreshAt}</strong>
            </div>
            <div style={{ marginTop: 14, display: "flex", gap: 8, flexWrap: "wrap" }}>
              <Button onClick={() => setTheme((t) => (t === "light" ? "dark" : "light"))}>Theme: {theme}</Button>
              <Button
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
              >
                Export CSV
              </Button>
            </div>
          </header>

          {error ? (
            <div className="gg-card" style={{ padding: 12, marginBottom: 16, borderColor: "var(--status-danger-bg)" }}>
              {error}
            </div>
          ) : null}

          <section id="overview" ref={sectionRefs.overview} style={{ marginBottom: 16 }}>
            <SectionHeader title="Overview KPIs" subtitle="Current performance and policy enforcement posture." />
            {overviewRows.length === 0 ? (
              <div className="gg-card" style={{ padding: 12 }}>No KPI data yet.</div>
            ) : (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12 }}>
                <KpiCard title="Total Requests" value={String(totalRequests)} />
                <KpiCard title="Blocked Requests" value={String(blockedRequests)} subtitle={`${blockRate.toFixed(1)}% of all traffic`} tone="danger" />
                <KpiCard title="Leak Events" value={String(leakEvents)} subtitle={`${leakRate.toFixed(1)}% leak rate`} tone="warn" />
                <KpiCard title="Avg Latency" value={`${avgLatency.toFixed(1)}ms`} tone="info" />
              </div>
            )}
          </section>

          <section id="trends" ref={sectionRefs.trends} style={{ marginBottom: 16, display: "grid", gridTemplateColumns: "2fr 1fr", gap: 12 }}>
            <article className="gg-card" style={{ padding: 14 }}>
              <h3 style={{ margin: "0 0 10px 0" }}>Blocked Request Trend</h3>
              {trendRows.length === 0 ? (
                <div className="gg-muted" style={{ fontSize: 13 }}>No trend points yet.</div>
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

            <article className="gg-card" style={{ padding: 14 }}>
              <h3 style={{ margin: "0 0 10px 0" }}>Live Incident Feed</h3>
              <div style={{ display: "grid", gap: 8 }}>
                {incidentFeed.length === 0 ? (
                  <div className="gg-muted" style={{ fontSize: 13 }}>No active incidents.</div>
                ) : (
                  incidentFeed.map((row, idx) => (
                    <button
                      key={idx}
                      onClick={() => setSelectedRequest(row)}
                      style={{
                        textAlign: "left",
                        border: "1px solid var(--border-default)",
                        borderRadius: 8,
                        background: "var(--bg-elevated)",
                        padding: 8,
                        cursor: "pointer"
                      }}
                    >
                      <div className="gg-muted" style={{ fontSize: 12 }}>{formatValue(row.timestamp)}</div>
                      <div style={{ fontSize: 13, fontWeight: 700 }}>{formatValue(row.action)}</div>
                      <div className="gg-muted" style={{ fontSize: 12 }}>Request: {formatValue(row.request_id)}</div>
                    </button>
                  ))
                )}
              </div>
            </article>
          </section>

          <section id="explorer" ref={sectionRefs.explorer} style={{ marginBottom: 20 }}>
            <SectionHeader title="Request Explorer" subtitle="Filter, inspect, and investigate policy decisions." />
            <TextInput
              placeholder="Filter by request id, user, or action..."
              value={requestFilter}
              onChange={(e) => setRequestFilter(e.target.value)}
              style={{ maxWidth: 420, marginBottom: 10 }}
            />
            <div style={{ display: "flex", gap: 8, marginBottom: 10, flexWrap: "wrap" }}>
              <SelectInput value={filterAction} onChange={(e) => { setFilterAction(e.target.value); setPage(1); }} style={{ width: 180 }}>
                <option value="all">Action: All</option>
                <option value="allow">allow</option>
                <option value="block_input">block_input</option>
                <option value="redact_stream">redact_stream</option>
                <option value="terminate_stream">terminate_stream</option>
              </SelectInput>
              <SelectInput value={filterSeverity} onChange={(e) => { setFilterSeverity(e.target.value); setPage(1); }} style={{ width: 180 }}>
                <option value="all">Severity: All</option>
                <option value="SAFE">SAFE</option>
                <option value="RED_FLAG">RED_FLAG</option>
                <option value="CRITICAL">CRITICAL</option>
              </SelectInput>
              <SelectInput value={rowsPerPage} onChange={(e) => { setRowsPerPage(Number(e.target.value)); setPage(1); }} style={{ width: 130 }}>
                <option value={10}>10 rows</option>
                <option value={20}>20 rows</option>
                <option value={50}>50 rows</option>
              </SelectInput>
            </div>
            {filteredDecisionRows.length === 0 ? (
              <div className="gg-card" style={{ padding: 12 }}>No request records match this filter.</div>
            ) : (
              <div className="gg-table-wrap">
                <table className="gg-table" style={{ minWidth: 1050 }}>
                  <thead>
                    <tr>
                      {["timestamp", "request_id", "user_id", "action", "input_score", "output_leak", "pii_tag", "latency_ms", "reason"].map((col) => (
                        <th key={col}>
                          {col.replaceAll("_", " ")}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {paginatedDecisionRows.map((row, idx) => {
                      return (
                        <tr key={idx} onClick={() => setSelectedRequest(row)} style={{ cursor: "pointer" }}>
                          <td>{formatValue(row.timestamp)}</td>
                          <td>{formatValue(row.request_id)}</td>
                          <td>{formatValue(row.user_id)}</td>
                          <td><Badge value={String(formatValue(row.action))} /></td>
                          <td>{formatValue(row.input_score)}</td>
                          <td>{formatValue(row.output_leak)}</td>
                          <td>{formatValue(row.pii_tag)}</td>
                          <td>{formatValue(row.latency_ms)}</td>
                          <td style={{ maxWidth: 420 }}>{decisionReason(row)}</td>
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
                <Button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1}>Prev</Button>
                <span style={{ fontSize: 13, alignSelf: "center" }}>Page {page} / {totalPages}</span>
                <Button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page >= totalPages}>Next</Button>
              </div>
            </div>
          </section>

          <section style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
            <Button variant={activeTab === "threats" ? "primary" : "default"} onClick={() => setActiveTab("threats")}>Threat Trends</Button>
            <Button variant={activeTab === "leaks" ? "primary" : "default"} onClick={() => setActiveTab("leaks")}>Leak Frequency</Button>
            <Button variant={activeTab === "users" ? "primary" : "default"} onClick={() => setActiveTab("users")}>User Behavior</Button>
            <Button variant={activeTab === "incidents" ? "primary" : "default"} onClick={() => setActiveTab("incidents")}>Critical Incidents</Button>
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
              <div className="gg-card" style={{ padding: 12 }}>No rows found for this query.</div>
            ) : (
              <div className="gg-table-wrap">
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
                  <table className="gg-table" style={{ minWidth: 700 }}>
                    <thead>
                      <tr>
                        {Object.keys(detailRows[0]).map((col) => (
                          <th key={col}>
                            {col.replaceAll("_", " ")}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {detailRows.map((row, idx) => (
                        <tr key={idx}>
                          {Object.keys(detailRows[0]).map((col) => (
                            <td key={`${idx}-${col}`}>
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

          <section className="gg-card" style={{ padding: 14 }}>
            <h3 style={{ marginTop: 0 }}>How this security flow works</h3>
            <ol className="gg-muted" style={{ margin: 0, paddingLeft: 18, lineHeight: 1.6 }}>
              <li>User prompt hits ViperGo proxy.</li>
              <li>Input scanner assigns threat score and may block prompt.</li>
              <li>Allowed traffic streams from LLM and output scanner redacts leaks.</li>
              <li>Events are logged and aggregated for this dashboard.</li>
            </ol>
          </section>
        </section>
      </div>

      <RequestDetailDrawer selectedRequest={selectedRequest} onClose={() => setSelectedRequest(null)} decisionReason={decisionReason} />
    </main>
  );
}
