"use client";

import { useEffect, useRef, useState } from "react";

interface LiveCounterProps {
  value: number;
  format?: (n: number) => string;
  increment?: number;
}

export function LiveCounter({ value, format, increment = 0 }: LiveCounterProps) {
  const [display, setDisplay] = useState(value);
  const targetRef = useRef(value);
  const displayRef = useRef(value);
  const rafRef = useRef<number>();

  useEffect(() => {
    targetRef.current = value;
  }, [value]);

  useEffect(() => {
    const animate = () => {
      const diff = targetRef.current - displayRef.current;
      if (Math.abs(diff) < 1) {
        displayRef.current = targetRef.current;
      } else {
        displayRef.current += diff * 0.1;
      }

      // Add live increment
      if (increment > 0) {
        targetRef.current += increment * (1 / 60); // per frame at ~60fps
      }

      setDisplay(Math.round(displayRef.current));
      rafRef.current = requestAnimationFrame(animate);
    };

    rafRef.current = requestAnimationFrame(animate);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [increment]);

  const formatted = format ? format(display) : display.toLocaleString("en-US");

  return <span className="font-mono tabular-nums">{formatted}</span>;
}
