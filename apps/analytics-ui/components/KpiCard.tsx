"use client";

type KpiCardProps = {
  title: string;
  value: string;
  subtitle?: string;
  border: string;
  bg: string;
  accent: string;
};

export function KpiCard({ title, value, subtitle, border, bg, accent }: KpiCardProps) {
  return (
    <article style={{ border: `1px solid ${border}`, borderRadius: 12, padding: 12, background: bg }}>
      <div style={{ fontSize: 12, color: accent }}>{title}</div>
      <div style={{ fontSize: 28, fontWeight: 800, marginTop: 6 }}>{value}</div>
      {subtitle ? <div style={{ fontSize: 12, color: accent }}>{subtitle}</div> : null}
    </article>
  );
}
