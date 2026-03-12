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
      <span
        className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2"
        style={{ fontSize: 16, color: "var(--text-muted)" }}
      >
        search
      </span>
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
          <span className="material-symbols-outlined" style={{ fontSize: 14 }}>close</span>
        </button>
      )}
    </div>
  );
}
