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
    <aside style={{ background: "#0f172a", color: "#e2e8f0", borderRadius: 14, padding: 16, height: "fit-content", position: "sticky", top: 16 }}>
      <h2 style={{ margin: "0 0 6px 0", fontSize: 20 }}>ViperGo</h2>
      <p style={{ margin: "0 0 14px 0", fontSize: 12, color: "#94a3b8" }}>Security Command Center</p>
      <div style={{ display: "grid", gap: 8 }}>
        {navItems.map((item) => (
          <button
            key={item.key}
            onClick={() => onSelect(item.key)}
            style={{
              textAlign: "left",
              border: "none",
              cursor: "pointer",
              padding: "8px 10px",
              borderRadius: 8,
              color: "#e2e8f0",
              background: active === item.key ? "#1e293b" : "transparent",
              fontSize: 13
            }}
          >
            {item.label}
          </button>
        ))}
      </div>
      <div style={{ marginTop: 14, padding: 10, borderRadius: 8, border: "1px solid #1e293b" }}>
        <div style={{ fontSize: 12, color: "#94a3b8" }}>Pipeline Health</div>
        <div style={{ marginTop: 8, fontSize: 13 }}>Proxy <span style={{ color: "#22c55e" }}>● healthy</span></div>
        <div style={{ fontSize: 13 }}>Scanner <span style={{ color: "#22c55e" }}>● healthy</span></div>
        <div style={{ fontSize: 13 }}>Logger <span style={{ color: "#22c55e" }}>● healthy</span></div>
      </div>
    </aside>
  );
}

export type { NavKey };
