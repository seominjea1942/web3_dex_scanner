"use client";

interface StatusDotProps {
  active?: boolean;
}

export function StatusDot({ active = true }: StatusDotProps) {
  return (
    <span
      className="inline-block w-2 h-2 rounded-full animate-pulse-dot"
      style={{ background: active ? "var(--accent-green)" : "var(--accent-red)" }}
    />
  );
}
