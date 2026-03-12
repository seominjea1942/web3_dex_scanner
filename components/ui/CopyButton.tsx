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
    <button
      onClick={handleCopy}
      className="font-mono text-xs px-1.5 py-0.5 rounded transition-colors"
      style={{
        color: copied ? "var(--accent-green)" : "var(--text-muted)",
        background: copied ? "rgba(34, 197, 94, 0.1)" : "transparent",
      }}
      title={text}
    >
      {copied ? <><span className="material-symbols-outlined align-middle" style={{ fontSize: 12 }}>check</span> Copied!</> : truncateAddress(text)}
    </button>
  );
}
