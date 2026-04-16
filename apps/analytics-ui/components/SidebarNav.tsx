"use client";

type NavKey = "overview" | "explorer" | "trends" | "leaks" | "users" | "incidents";

type SidebarNavProps = {
  active: NavKey;
  onSelect: (key: NavKey) => void;
};

const navItems: Array<{ key: NavKey; label: string }> = [
  { key: "overview", label: "Overview" },
  { key: "explorer", label: "Request Explorer" },
  { key: "trends", label: "Threat Trends" },
  { key: "leaks", label: "Leaks" },
  { key: "users", label: "Users" },
  { key: "incidents", label: "Incidents" }
];

export function SidebarNav({ active, onSelect }: SidebarNavProps) {
  return (
    <aside className="gg-card" style={{ padding: 16, height: "fit-content", position: "sticky", top: 16 }}>
      <h2 style={{ margin: "0 0 6px 0", fontSize: 20 }}>Griffin Guard</h2>
      <p className="gg-muted" style={{ margin: "0 0 14px 0", fontSize: 12 }}>Security Command Center</p>
      <div style={{ display: "grid", gap: 8 }}>
        {navItems.map((item) => (
          <button
            key={item.key}
            onClick={() => onSelect(item.key)}
            style={{
              textAlign: "left",
              border: "1px solid var(--border-default)",
              cursor: "pointer",
              padding: "8px 10px",
              borderRadius: 8,
              color: "var(--text-primary)",
              background: active === item.key ? "var(--bg-muted)" : "transparent",
              fontSize: 13
            }}
          >
            {item.label}
          </button>
        ))}
      </div>
      <div style={{ marginTop: 14, padding: 10, borderRadius: 8, border: "1px solid var(--border-default)", background: "var(--bg-muted)" }}>
        <div className="gg-muted" style={{ fontSize: 12 }}>Pipeline Health</div>
        <div style={{ marginTop: 8, fontSize: 13 }}>Proxy <span style={{ color: "var(--status-success-text)" }}>● healthy</span></div>
        <div style={{ fontSize: 13 }}>Scanner <span style={{ color: "var(--status-success-text)" }}>● healthy</span></div>
        <div style={{ fontSize: 13 }}>Logger <span style={{ color: "var(--status-success-text)" }}>● healthy</span></div>
      </div>
    </aside>
  );
}

export type { NavKey };
