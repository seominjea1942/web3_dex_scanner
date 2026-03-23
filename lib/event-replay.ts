/**
 * Event replay — DEPRECATED in Phase 2.
 * Real events now flow via Helius webhooks → /api/webhooks/helius.
 * Keeping as no-op so existing imports don't break.
 */

export async function replayOneEvent(): Promise<void> {
  // No-op: real events come from Helius webhooks now.
}
