/**
 * Spike-aware metric generation for ongoing data points.
 * Uses module-level state to track mini-spikes that form in real-time.
 * Latency ALWAYS stays flat (2.7–3.6ms) — this is the HTAP proof.
 */

interface SpikeState {
  active: boolean;
  startTime: number;
  duration: number; // ms
  intensity: number; // multiplier (1.5–2.0)
}

// Module-level state — persists between invocations in the same serverless instance
let spikeState: SpikeState = { active: false, startTime: 0, duration: 0, intensity: 0 };

const BASELINE = {
  write: 15000,
  latency: 3.0,
  connections: 1500,
  qps: 10000,
};

export function generateSpikeMetrics(): {
  wt: number;
  ql: number;
  qps: number;
  conn: number;
} {
  const now = Date.now();

  // Check if current spike has ended
  if (spikeState.active && now > spikeState.startTime + spikeState.duration) {
    spikeState.active = false;
  }

  // ~5% chance per call to start a new spike (calls happen every ~5-15s)
  if (!spikeState.active && Math.random() < 0.03) {
    spikeState = {
      active: true,
      startTime: now,
      duration: (120 + Math.random() * 60) * 1000, // 2-3 minutes
      intensity: 1.5 + Math.random() * 0.5, // 1.5x–2.0x
    };
  }

  let writeExtra = 0;
  let connExtra = 0;
  let qpsExtra = 0;

  if (spikeState.active) {
    const elapsed = now - spikeState.startTime;
    const total = spikeState.duration;
    const rampPortion = 0.2; // 20% of duration for ramp up/down

    let progress: number;
    if (elapsed < total * rampPortion) {
      // Ramp up
      progress = elapsed / (total * rampPortion);
    } else if (elapsed > total * (1 - rampPortion)) {
      // Ramp down
      progress = (total - elapsed) / (total * rampPortion);
    } else {
      // Peak
      progress = 1;
    }

    writeExtra = BASELINE.write * (spikeState.intensity - 1) * progress;
    connExtra = 1500 * (spikeState.intensity - 1) * progress;
    qpsExtra = 3000 * (spikeState.intensity - 1) * progress;
  }

  const wt = BASELINE.write + writeExtra + (Math.random() - 0.5) * 4000;
  const conn = BASELINE.connections + connExtra + (Math.random() - 0.5) * 400;
  const qps = BASELINE.qps + qpsExtra + (Math.random() - 0.5) * 2000;

  // Latency STAYS FLAT — the HTAP proof
  const ql = spikeState.active
    ? 3.3 + (Math.random() - 0.5) * 0.6 // 3.0–3.6ms during spike
    : 3.0 + (Math.random() - 0.5) * 0.6; // 2.7–3.3ms normal

  return {
    wt: Math.max(1000, Math.round(wt)),
    ql: Math.max(0.5, Math.round(ql * 100) / 100),
    qps: Math.max(1000, Math.round(qps)),
    conn: Math.max(100, Math.round(conn)),
  };
}
