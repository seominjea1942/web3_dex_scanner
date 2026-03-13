"use client";

import { useState } from "react";
import { truncateAddress } from "@/lib/format";

interface CopyButtonProps {
  text: string;
}

export function CopyButton({ text }: CopyButtonProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <span className="inline-flex items-center gap-1">
      <span
        className="font-mono text-sm"
        style={{ color: "var(--text-muted)" }}
      >
        {truncateAddress(text)}
      </span>
      <button
        onClick={handleCopy}
        className="p-0.5 rounded transition-colors"
        style={{
          color: copied ? "var(--accent-green)" : "var(--text-muted)",
        }}
        title={copied ? "Copied!" : "Copy address"}
      >
        <span className="material-symbols-outlined" style={{ fontSize: 14 }}>
          {copied ? "check" : "content_copy"}
        </span>
      </button>
    </span>
  );
}
