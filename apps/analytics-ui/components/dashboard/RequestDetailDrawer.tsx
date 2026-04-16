"use client";

type DashboardRow = Record<string, unknown>;

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

export function RequestDetailDrawer({
  selectedRequest,
  onClose,
  decisionReason,
}: {
  selectedRequest: DashboardRow | null;
  onClose: () => void;
  decisionReason: (row: DashboardRow) => string;
}) {
  if (!selectedRequest) {
    return null;
  }

  return (
    <>
      <div className="gg-drawer-backdrop" onClick={onClose} />
      <aside className="gg-drawer" role="dialog" aria-modal="true" aria-label="Request detail">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h3 style={{ margin: 0 }}>Request Detail</h3>
          <button onClick={onClose} className="gg-btn">
            Close
          </button>
        </div>
        <p className="gg-muted" style={{ fontSize: 13 }}>
          Full event details and decision context
        </p>
        <div style={{ display: "grid", gap: 8 }}>
          {Object.entries(selectedRequest).map(([k, v]) => (
            <div key={k} style={{ border: "1px solid var(--border-default)", borderRadius: 8, padding: 8 }}>
              <div className="gg-muted" style={{ fontSize: 12 }}>{k}</div>
              <div style={{ fontSize: 14 }}>{formatValue(v)}</div>
            </div>
          ))}
        </div>
        <div style={{ marginTop: 12, background: "var(--bg-muted)", border: "1px solid var(--border-default)", borderRadius: 8, padding: 10 }}>
          <div style={{ fontWeight: 700, marginBottom: 4 }}>Decision Summary</div>
          <div style={{ fontSize: 14 }}>{decisionReason(selectedRequest)}</div>
        </div>
      </aside>
    </>
  );
}
