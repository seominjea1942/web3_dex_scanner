"use client";

import { useState, useEffect, useRef } from "react";

interface SearchBarProps {
  value: string;
  onChange: (value: string) => void;
}

export function SearchBar({ value, onChange }: SearchBarProps) {
  const [local, setLocal] = useState(value);
  const timer = useRef<NodeJS.Timeout>();

  useEffect(() => {
    timer.current = setTimeout(() => onChange(local), 300);
    return () => clearTimeout(timer.current);
  }, [local, onChange]);

  return (
    <div className="relative flex-1 min-w-[200px] max-w-sm">
      <svg
        className="absolute left-3 top-1/2 -translate-y-1/2"
        width="14" height="14" viewBox="0 0 14 14" fill="none"
        stroke="var(--text-muted)" strokeWidth="1.5"
      >
        <circle cx="6" cy="6" r="5" />
        <path d="M10 10l3.5 3.5" strokeLinecap="round" />
      </svg>
      <input
        type="text"
        value={local}
        onChange={(e) => setLocal(e.target.value)}
        placeholder="Search tokens, pools, or addresses..."
        className="w-full pl-9 pr-8 py-2 rounded-lg text-sm border outline-none transition-colors"
        style={{
          background: "var(--bg-card)",
          borderColor: "var(--border)",
          color: "var(--text-primary)",
        }}
      />
      {local && (
        <button
          onClick={() => { setLocal(""); onChange(""); }}
          className="absolute right-3 top-1/2 -translate-y-1/2"
          style={{ color: "var(--text-muted)" }}
        >
          ✕
        </button>
      )}
    </div>
  );
}
