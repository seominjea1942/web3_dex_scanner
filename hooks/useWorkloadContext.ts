"use client";

import { useState, useEffect } from "react";

interface WorkloadContext {
  dataset_count: number;
  table_count: number;
  index_count: number;
}

let cached: WorkloadContext | null = null;

export function useWorkloadContext(): WorkloadContext | null {
  const [data, setData] = useState<WorkloadContext | null>(cached);

  useEffect(() => {
    if (cached) return;
    fetch("/api/workload-context")
      .then((r) => r.json())
      .then((d: WorkloadContext) => {
        cached = d;
        setData(d);
      })
      .catch(() => {});
  }, []);

  return data;
}
