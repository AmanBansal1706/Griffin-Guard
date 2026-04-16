"use client";

import type { PropsWithChildren } from "react";

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "default" | "primary";
};

export function Card({ children, className = "" }: PropsWithChildren<{ className?: string }>) {
  return <section className={`gg-card ${className}`.trim()}>{children}</section>;
}

export function Button({ variant = "default", className = "", ...props }: ButtonProps) {
  const variantClass = variant === "primary" ? "gg-btn-primary" : "";
  return <button className={`gg-btn ${variantClass} ${className}`.trim()} {...props} />;
}

export function Badge({ value }: { value: string }) {
  const kind = value || "allow";
  return <span className={`gg-badge gg-badge-${kind}`}>{value}</span>;
}

export function TextInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input className="gg-input" {...props} />;
}

export function SelectInput(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className="gg-select" {...props} />;
}

export function SectionHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div style={{ marginBottom: 10 }}>
      <h2 className="gg-section-title">{title}</h2>
      {subtitle ? <p className="gg-muted" style={{ margin: 0, fontSize: 13 }}>{subtitle}</p> : null}
    </div>
  );
}
