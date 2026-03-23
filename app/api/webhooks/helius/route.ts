import { NextResponse } from "next/server";
import { getPool } from "@/lib/db";
import {
  parseSwapToTransaction,
  deriveEventType,
  deriveSeverity,
  formatCompactUsd,
  type HeliusEnhancedTransaction,
} from "@/lib/helius";
import crypto from "crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Verify Helius webhook signature.
 * Helius signs payloads with HMAC-SHA256 using the webhook secret.
 */
function verifySignature(rawBody: string, signature: string | null): boolean {
  const secret = process.env.HELIUS_WEBHOOK_SECRET;
  if (!secret) return true; // no secret configured → skip verification
  if (!signature) return false;

  const expected = crypto
    .createHmac("sha256", secret)
    .update(rawBody)
    .digest("base64");

  try {
    return crypto.timingSafeEqual(
      Buffer.from(signature),
      Buffer.from(expected)
    );
  } catch {
    return false;
  }
}

export async function POST(req: Request) {
  try {
    const rawBody = await req.text();

    // Verify webhook signature
    const signature = req.headers.get("helius-signature");
    if (!verifySignature(rawBody, signature)) {
      console.warn("Helius webhook: invalid signature");
      return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
    }

    const body = JSON.parse(rawBody);

    // Body is an array of enhanced transactions
    const transactions: HeliusEnhancedTransaction[] = Array.isArray(body)
      ? body
      : [body];

    if (transactions.length === 0) {
      return NextResponse.json({ ok: true, processed: 0 });
    }

    const db = getPool();

    // Filter SWAP transactions for swap_transactions table
    const swaps = transactions.filter((tx) => tx.type === "SWAP");

    // Batch INSERT swaps into swap_transactions
    const txValues: (string | number)[] = [];
    const txPlaceholders: string[] = [];

    for (const swap of swaps) {
      const parsed = parseSwapToTransaction(swap);
      if (!parsed || parsed.usd_value < 1) continue;

      txPlaceholders.push("(?, ?, ?, ?, ?, ?, ?, ?, ?)");
      txValues.push(
        parsed.signature,
        parsed.timestamp,
        parsed.pool_address,
        parsed.dex,
        parsed.side,
        parsed.token_amount,
        parsed.quote_amount,
        parsed.usd_value,
        parsed.trader_wallet
      );
    }

    if (txPlaceholders.length > 0) {
      await db.execute(
        `INSERT IGNORE INTO swap_transactions
         (signature, timestamp, pool_address, dex, side, base_amount, quote_amount, usd_value, trader_wallet)
         VALUES ${txPlaceholders.join(",\n")}`,
        txValues
      );
    }

    // Insert into defi_events for the live ticker
    const evValues: (string | number)[] = [];
    const evPlaceholders: string[] = [];

    for (const tx of transactions) {
      const parsed = parseSwapToTransaction(tx);
      if (!parsed || parsed.usd_value < 1) continue;

      const eventType = deriveEventType(parsed);
      const severity = deriveSeverity(eventType);

      const desc =
        eventType === "whale"
          ? `whale ${parsed.side} ${formatCompactUsd(parsed.usd_value)} via ${parsed.dex}`
          : `${parsed.side} ${formatCompactUsd(parsed.usd_value)} via ${parsed.dex}`;

      evPlaceholders.push("(?, ?, ?, ?, ?, ?, ?, ?)");
      evValues.push(
        eventType,
        parsed.timestamp,
        parsed.pool_address,
        parsed.dex,
        severity,
        parsed.trader_wallet,
        parsed.usd_value,
        desc
      );
    }

    if (evPlaceholders.length > 0) {
      await db.execute(
        `INSERT INTO defi_events
         (event_type, timestamp, pool_address, dex, severity, trader_wallet, usd_value, description)
         VALUES ${evPlaceholders.join(",\n")}`,
        evValues
      );
    }

    console.log(
      `Helius webhook: processed ${transactions.length} transactions (${swaps.length} swaps)`
    );

    return NextResponse.json({ ok: true, processed: transactions.length });
  } catch (e) {
    console.error("POST /api/webhooks/helius error:", e);
    return NextResponse.json(
      { error: "Webhook processing failed" },
      { status: 500 }
    );
  }
}
