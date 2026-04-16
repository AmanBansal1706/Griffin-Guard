"use client";

type KpiCardProps = {
  title: string;
  value: string;
  subtitle?: string;
  tone?: "default" | "danger" | "warn" | "info";
};

export function KpiCard({ title, value, subtitle, tone = "default" }: KpiCardProps) {
  const toneStyle =
    tone === "danger"
      ? { borderColor: "var(--status-danger-bg)" }
      : tone === "warn"
        ? { borderColor: "var(--status-warn-bg)" }
        : tone === "info"
          ? { borderColor: "var(--accent)" }
          : undefined;
  return (
    <article className="gg-card" style={{ padding: 12, ...toneStyle }}>
      <div className="gg-muted" style={{ fontSize: 12 }}>{title}</div>
      <div style={{ fontSize: 28, fontWeight: 800, marginTop: 6 }}>{value}</div>
      {subtitle ? <div className="gg-muted" style={{ fontSize: 12 }}>{subtitle}</div> : null}
    </article>
  );
}
